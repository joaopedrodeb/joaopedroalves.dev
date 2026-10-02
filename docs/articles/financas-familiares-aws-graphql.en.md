How can a finance app let two people read and edit shared transactions when one device has been offline? In this project, I combined a **.NET 10 API**, **PostgreSQL**, federated authentication through **Amazon Cognito**, AWS infrastructure defined with **Terraform**, and two interfaces: **REST and GraphQL**.

Each device keeps a local copy, while the API maintains the family's shared data. Beyond accepting changes, the server identifies the person behind each action, enforces group boundaries, and helps the application resolve concurrent edits.

This case study covers the implementation in [api-previsao-financeira](https://github.com/joaopedrodeb/api-previsao-financeira), its development infrastructure, and its current limits. Examples use fictional data. The screenshots show exploration tools, rather than proof that every business operation has been completed.

## The problem: shared data needs more than database writes

Imagine João records a grocery purchase. Maria belongs to the same family group and corrects its category. João, still offline, changes the purchase amount using an older copy.

Silently accepting the latest request could erase somebody's change. Retrying a request after a network failure could create a duplicate purchase. Physically deleting a transaction could prevent an offline device from learning about the deletion.

The contract therefore needs **identity, authorization, idempotency, versions, history, and incremental synchronization**. GraphQL provides a language for accessing these capabilities; application rules and database transactions provide consistency.

## The implemented architecture

```text
Family application
  ├── SQLite: transactions, pending queue, cursor per account/group
  ├── Google login → Cognito → access token
  └── HTTPS → HTTP API Gateway → .NET 10 API on EC2
                                  ├── REST + Swagger
                                  ├── GraphQL + Nitro
                                  └── PostgreSQL: shared data and change log

GitHub Actions → OIDC → IAM Role → ECR / S3 / SSM → EC2
Terraform → AWS infrastructure definitions and state
CloudWatch → logs, metrics, and alarms
```

The backend separates responsibilities into layers. **Domain** contains business concepts; **Application** depends only on Domain; **Persistence** implements storage; **Api** composes services and exposes the interfaces. Cloud dependencies stay out of domain entities, making hosting and persistence changes easier to isolate.

REST and GraphQL share identity and business rules. The consuming application implements its own SQLite copy; the backend supplies the synchronization protocol. The repository's [family synchronization guide](https://github.com/joaopedrodeb/api-previsao-financeira/blob/develop/docs/family-sync.md) documents the implemented behavior.

## AWS: what each service does

The DEV environment runs in **sa-east-1**, São Paulo. Docker Compose hosts the application and PostgreSQL on the same **EC2 t4g.micro**, using ARM64/Graviton. This keeps development operations manageable, but requires ARM64-compatible images and puts the application and database on one machine.

| Service | Responsibility in this project |
| --- | --- |
| EC2 and EBS | Run containers and retain database storage on an encrypted persistent volume. |
| HTTP API Gateway | Provide the public HTTPS entry point, forward requests, and configure CORS and request limits. |
| Cognito User Pool | Supply the identity accepted by the API and federate the environment's existing Google login. |
| ECR | Store container images for deployment. |
| Systems Manager | Execute deployment commands on the instance without a manual SSH session. |
| Parameter Store | Keep the PostgreSQL password in SecureString, outside source code and Terraform state. |
| S3 | Store deployment artifacts and resources planned for reports; Terraform uses a separate remote-state backend. |
| CloudWatch | Receive logs and provide metrics and alarms for signals such as CPU and API/Gateway errors. |
| IAM and STS | Define permissions and provide temporary sessions for workloads and deployment. |

Terraform also defines **DynamoDB, SQS, and a dead-letter queue** as groundwork for reporting features. Financial synchronization currently persists in PostgreSQL: it does not send every transaction to that queue or store transactions in DynamoDB. The REST reports endpoint remains a scaffold returning `204`. Provisioned infrastructure does not prove that its corresponding feature is complete.

There is a network boundary to understand: the Gateway accepts HTTPS, but its current integration forwards to the backend over **HTTP on port 8080**. The Nitro screenshot shows direct EC2 access used for DEV diagnosis. Consumers sending credentials should use the authorized HTTPS entry point. Restricting direct origin access and protecting that network segment are further improvements; public HTTPS does not encrypt every downstream hop.

This is also a single-machine development architecture, without RDS, a load balancer, or a Multi-AZ database. Costs depend on provisioned resources, storage, logs, and traffic. Resources not yet used by the feature still belong in cost reviews.

## Terraform: infrastructure that can be reviewed

Terraform describes desired infrastructure in HCL. Providers communicate with AWS, **state** maps declarations to existing resources, and **plan** previews changes. Configuration becomes a versioned change that can be reviewed instead of an undocumented sequence of console clicks.

Here, the definitions cover networking, the instance, image storage, Gateway, IAM policies, and observability. Variables separate environment parameters from structural choices. The S3 remote backend uses encryption and locking to prevent concurrent changes; bucket versioning helps recover state. State remains sensitive even when the database password is managed separately. See the [S3 backend documentation](https://developer.hashicorp.com/terraform/language/backend/s3).

The project's general requirement is Terraform `>= 1.8`, but the current backend uses `use_lockfile`, introduced in **1.10**, as documented in the [AWS backend guide](https://docs.aws.amazon.com/prescriptive-guidance/latest/terraform-aws-provider-best-practices/backend.html). Use a compatible CLI for this backend rather than assuming every version above 1.8 supports all configuration files.

A review workflow, in a checkout configured for your own account, is:

```powershell
aws sso login --profile finance-dev
$env:AWS_PROFILE = "finance-dev"
terraform -chdir=iac/terraform fmt -check -recursive
terraform -chdir=iac/terraform init
terraform -chdir=iac/terraform validate
terraform -chdir=iac/terraform plan -var-file="dev.tfvars"
```

Before `init`, adapt the backend bucket and state key to resources under your administration. Configure required external identifiers such as VPC/subnet, Cognito, and the OIDC provider. Do not reuse someone else's backend. If resources already exist, plan imports and ownership migration before applying changes; recreating infrastructure without recognizing existing resources can cause loss or downtime.

Planning requires valid credentials and its output may contain sensitive information. Applying infrastructure is a separate operational decision after review, unrelated to trying a GraphQL query. The [DEV deployment guide](https://github.com/joaopedrodeb/api-previsao-financeira/blob/develop/docs/deployment-dev.md) supplies repository-specific procedures.

## REST and GraphQL: why keep both?

REST organizes an interface around resources and HTTP semantics. A request such as `GET /api/Users/{id}` has an explicit route; methods, status codes, and response representations form the contract. In a well-designed REST API, GET reads without triggering business changes, while PUT and DELETE can have idempotent behavior. The [HTTP standard](https://www.rfc-editor.org/rfc/rfc9110.html) defines method semantics.

GraphQL exposes a typed schema and lets clients select the fields they need. A **query** reads, a **mutation** changes data, and a **subscription** delivers notifications when supported by the transport. Typed arguments and variables separate the operation from its input values. Field selection can reduce round trips and unnecessary data for screens that combine users, groups, and transactions. See the [official guide to queries and mutations](https://graphql.org/learn/queries/).

| Concern | REST | GraphQL |
| --- | --- | --- |
| Contract | Routes, methods, payloads, and HTTP status codes | Schema with types, fields, arguments, and operations |
| Response selection | Representation defined by the endpoint | Fields selected by the consumer |
| Interactive documentation | OpenAPI and Swagger UI | Schema, introspection, and tools such as Nitro |
| Errors | HTTP status and a contract-specific response body | Transport errors plus an `errors` envelope, sometimes with HTTP 200 |
| Caching | Can use HTTP semantics | Must account for operation, variables, identity, and client-side caching |

The implementation keeps `/auth`, `/version`, health checks, and self-account registration in `/api/Users` on REST. GraphQL handles groups, invitations, transactions, history, and synchronization. REST user queries are not a public directory: each authenticated user sees only their own account.

This preserves existing uses while providing an appropriate contract for the new app. There is no requirement to move every operation to GraphQL. A typed schema does not automatically isolate users; application authorization checks each group and operation. The [GraphQL authorization guide](https://graphql.org/learn/authorization/) explains that separation.

## Swagger and Nitro: exploring both interfaces

<figure>
  <img src="images/artigos/Captura%20de%20tela%202026-10-02%20091005.png" alt="Project Swagger UI displaying the REST Auth, version, and Reports endpoints." loading="lazy" />
  <figcaption>Swagger UI explores the REST HTTP contracts.</figcaption>
</figure>

Swagger does not automatically turn every query and mutation into a route. GraphQL operations reach `/graphql`, while the schema describes their available fields.

<figure>
  <img src="images/artigos/Captura%20de%20tela%202026-10-02%20090933.png" alt="Nitro start screen with Create Document and Browse Schema options for exploring GraphQL." loading="lazy" />
  <figcaption>Nitro creates operations and explores the GraphQL schema. This capture used direct diagnostic access to DEV.</figcaption>
</figure>

**Nitro**, integrated with Hot Chocolate, is available at `/graphql/ui`. In `Development`, its page opens without a token, but operations, introspection, and schema downloads remain authenticated. Swagger links to it. The exploration page is not published in `Production`.

Obtain an access token through the authorized login, open the tool through DEV's HTTPS entry point, and configure `Authorization: Bearer <access_token>` in its headers. Introspection can then display fields and arguments, and you can execute a query. Avoid publishing screenshots containing that header. The [Hot Chocolate documentation](https://chillicream.com/docs/hotchocolate/server/endpoints) describes endpoint and Nitro integration.

## IAM and Cognito: who needs which access?

There are two audiences. **AWS operators** need account permissions for infrastructure, logs, or deployment. **Application users** need a Cognito identity and family membership. A family member does not need an IAM account to record expenses.

For an infrastructure collaborator, an administrator should grant an individual identity, preferably through **IAM Identity Center** or the organization's federation. Provide the access-portal address, identify the account, and assign a task-appropriate permission set with MFA. The collaborator configures their own profile:

```powershell
aws configure sso --profile finance-dev
aws sso login --profile finance-dev
aws sts get-caller-identity --profile finance-dev
```

If the organization still uses IAM users, provisioning should also be individual and limited. Shared root credentials, passwords, or permanent access keys are not integration requirements. AWS recommends federation, temporary credentials, and least privilege in its [IAM best practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html).

Deployment uses a third identity: **GitHub Actions assumes an IAM Role through OIDC**. Trust is restricted to the repository and the `development` Environment. Runs receive temporary credentials for ECR, artifacts, and SSM. The DEV deploy workflow is manual; CI validates source changes. No permanent AWS access key needs to be saved in GitHub. See [GitHub's AWS OIDC guide](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws).

## Registering and inviting application users

Google login is federated through an existing Cognito configuration. A new application's developer needs the HTTPS API URL, Cognito login domain, and public App Client configuration. Callback URLs, logout URLs, and scopes must be approved for that client. This project does not automatically create or modify the User Pool or Google provider.

For a public mobile or browser client, use **Authorization Code with PKCE**, `state`, and registered callbacks. Do not embed a client secret in the app. Request `openid email profile` within the client's allowed scopes. The [Cognito authorization endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html) documents the flow.

Send the **access token**, not the ID token, to the API. The backend verifies signature, issuer, expiration, `token_use=access`, and `client_id`. It fetches `/oauth2/userInfo`, matches the profile to `sub`, and requires a verified `gmail.com` address. The [userInfo endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/userinfo-endpoint.html) provides the authorized profile; the `GetUser` fallback requires `aws.cognito.signin.user.admin`.

The first valid `me` query creates the local account or links a legacy account without a Cognito identity. The verified identity determines who performed each change; clients cannot freely choose an author.

The family workflow is:

1. The first member signs in and calls `me` and `createGroup`.
2. They become `OWNER` and invite another verified Gmail address using `inviteMember`.
3. The recipient signs in with their own account, reads `myInvites`, and calls `acceptInvite`.
4. Both access the group with their assigned permissions.

Invitations last seven days and are retrieved in the app: the current implementation **does not send invitation emails**. `OWNER` manages members and edits transactions; `EDITOR` can also create, edit, and delete any transaction in the group; `VIEWER` reads only. Removal revokes a member's access; the owner cannot be removed.

## Integration: the first GraphQL request

After login, this query returns the current account and their groups:

```graphql
query StartApplication {
  me { id name email }
  myGroups { id name }
}
```

A JavaScript client can send it as follows:

```javascript
async function executeGraphQL(apiBase, accessToken, query, variables = {}) {
  const response = await fetch(`${apiBase.replace(/\/$/, '')}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({ query, variables })
  });

  if (!response.ok) throw new Error(`HTTP failure: ${response.status}`);
  const result = await response.json();
  // Preserve both: GraphQL can return partial data alongside errors.
  return { data: result.data, errors: result.errors ?? [] };
}
```

Consumers must inspect `errors` even after HTTP 200. Expired tokens require renewal through the provider; denied access should not cause endless retries. Use the platform's appropriate secure token storage and keep credentials out of logs.

For browser clients, configure CORS for the application's actual origin. DEV currently defines local origins, rather than allowing every site. CORS is a browser access mechanism, not identity or membership authorization. The full versioned contract is in [docs/graphql/schema.graphql](https://github.com/joaopedrodeb/api-previsao-financeira/blob/develop/docs/graphql/schema.graphql).

## Offline synchronization: queue, cursor, and conflicts

Creation uses a device-generated `clientId` and a `clientMutationId` identifying the operation. Generate them before persisting the local queue and retain them across retries. The server reserves `clientId` within the group and recognizes retries by the idempotency key. Reusing a key with a different payload is rejected.

Updates require `expectedVersion`. If two devices start from version 3, the first update produces version 4; the second receives a conflict with the current server state. The app should present this difference or apply an explicit resolution policy instead of silently overwriting data.

```graphql
mutation Synchronize($input: SyncChangesInput!) {
  syncChanges(input: $input) {
    applied { id clientId version deletedAt }
    conflicts { clientId reason serverExpense { id version description amount } }
    rejected { clientId reason }
    changes {
      cursor operation changedAt changedBy { id name }
      expense {
        id clientId groupId description amount category rawMessage entryType paymentMethod
        occurredAt createdAt updatedAt version deletedAt
        createdBy { id name } updatedBy { id name }
      }
    }
    nextCursor
    hasMore
  }
}
```

Variables contain `groupId`, `deviceId`, `sinceCursor`, and `changes`. This example creates an expense. Replace `groupId` with the real ID of a group you belong to:

```json
{
  "input": {
    "groupId": "11111111-1111-4111-8111-111111111111",
    "deviceId": "demo-phone",
    "sinceCursor": null,
    "changes": [{
      "clientId": "demo-phone-purchase-001",
      "clientMutationId": "demo-phone-operation-001",
      "operation": "CREATED",
      "description": "Groceries",
      "amount": -245.90,
      "category": "Food",
      "entryType": "DESPESA",
      "occurredAt": "2026-10-02T12:00:00Z"
    }]
  }
}
```

For updates, send `operation: "UPDATED"`, the same `clientId`, a **new** operation key, and the server's `expectedVersion`. For deletion, use `"DELETED"` and include the expected version. A new action gets a new key; a retry retains its original key. `deviceId` is operational identification, not proof of identity.

Initial downloads can send an empty queue. A request accepts up to **100 local operations** and returns up to **500 remote changes**:

| Field | Client responsibility |
| --- | --- |
| `applied` | Acknowledge accepted operations and update local IDs/versions. |
| `conflicts` | Retain conflicts and present server state for resolution. |
| `rejected` | Show or correct the cause instead of retrying indefinitely. |
| `changes` | Apply remote snapshots in order, including deletions. |
| `nextCursor` and `hasMore` | Persist progress and request additional batches when needed. |

An invalid operation does not undo valid operations in its batch. Apply remote changes and save the cursor **in one SQLite transaction**; saving only the cursor can skip data after interruption. Ignore snapshots older than the locally stored version. Scope caches by account and group, removing or isolating the previous account's data when users switch.

Money uses `decimal(18,2)`: `DESPESA` is negative, `RENDA` positive, and zero is rejected. Avoid binary floating-point arithmetic for client money calculations; integer cents or decimal libraries help. Dates normalize to UTC. Transaction dates can be backdated, while creation and modification timestamps come from the server.

Deletion is logical. The server retains `deletedAt` and a deletion snapshot, a **tombstone**, so an offline device can learn about removal. `recentActions` identifies who created, changed, or deleted transactions and when. This is financial history, rather than a comprehensive audit of logins and administrative changes.

## Notifications and transport limitations

The backend implements `expenseChanged` using `graphql-transport-ws`. The subscription polls the durable log every two seconds, verifies group membership, and closes when the token expires. A cursor can help recover changes after reconnecting.

However, the project's **HTTP API Gateway does not carry WebSocket upgrades**. Through its public URL, clients should use HTTP `syncChanges` or `changes` periodically and when returning to the foreground. Public subscriptions require a WebSocket-compatible network path with TLS. Creating a separate API Gateway WebSocket API does not transparently proxy the existing protocol.

Notifications reduce waiting time; the durable log and cursor allow local data to recover after disconnection.

## Running locally and validating the backend

Clone the repository and follow its README for Compose environment variables. You need .NET 10, Docker, and the repository's local tools. Identity configuration depends on your authorized environment; there is no shared token in source code.

```powershell
git clone https://github.com/joaopedrodeb/api-previsao-financeira.git
cd api-previsao-financeira
dotnet tool restore
dotnet restore PrevisaoFinanceira.Api.slnx
dotnet build PrevisaoFinanceira.Api.slnx --configuration Release --no-restore
dotnet test PrevisaoFinanceira.Api.slnx --configuration Release --no-build
dotnet format PrevisaoFinanceira.Api.slnx --verify-no-changes --no-restore
docker compose config
```

Integration tests start disposable PostgreSQL in Docker and use locally signed JWTs, without real AWS resources. They exercise the contract, authorization, synchronization, and WebSocket behavior, and compare the published schema with the executable schema. Repository validation also covers AMD64/ARM64 container builds, idempotent migration scripts, and Terraform configuration.

The migration adds groups, members, invitations, transactions, a change log, and idempotency receipts while preserving existing users. Production applies migrations through an operational process, rather than automatically at startup.

## Decisions that must evolve with usage

The implementation uses a **global PostgreSQL transactional advisory lock** to order commits and cursor delivery. This conservative strategy prevents changes from being skipped because commits finish out of order, but serializes operations across all groups, including reads. Higher volume requires measuring contention and redesigning lock/cursor partitioning.

Idempotency receipts and tombstones do not expire automatically. That protects retries and offline devices but increases storage. A future retention policy needs a full-resynchronization protocol for devices with outdated cursors.

Further work includes backup and restore verification, separating database and application when needed, protecting the origin, reviewing existing IAM permissions, and defining GraphQL execution-cost limits. AWS hosting does not remove these decisions; infrastructure definitions, tests, and logs make them easier to document and review.

## What to share with an integrating developer

Share **the authorized environment's HTTPS URL**, public Cognito configuration, approved callback, this article, and the schema. Developers should sign in with their own Google account, create or accept a group, and test queries and synchronization with fictional data. Do not send AWS passwords, access tokens, or infrastructure secrets.

For an operator, also provide individual AWS-portal access, account/profile details, agreed permissions, the deployment guide, and authorized state/parameter locations. AWS console access does not grant family membership; family membership does not grant cloud administration.

The project's practical benefit is combining shared family access with explicit identity, consistency, and operational rules. REST preserves useful contracts, GraphQL organizes application interaction, and Terraform makes infrastructure reviewable. The knowledge lies in both the technologies and the decisions required to make them work together.
