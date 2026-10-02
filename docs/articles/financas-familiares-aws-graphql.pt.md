Como transformar um aplicativo de finanças em uma experiência compartilhada, na qual duas pessoas conseguem consultar e editar os mesmos lançamentos, mesmo quando uma delas passou algum tempo offline? Neste projeto, combinei uma API em **.NET 10**, **PostgreSQL**, autenticação federada pelo **Amazon Cognito**, infraestrutura AWS descrita em **Terraform** e duas formas de acesso: **REST e GraphQL**.

O objetivo é concreto: cada aparelho mantém sua cópia local, enquanto a API guarda a cópia compartilhada de cada família. Além de receber alterações, o servidor identifica quem realizou cada ação, impede acesso entre grupos e ajuda o aplicativo a resolver conflitos.

Este artigo apresenta a implementação disponível no [repositório api-previsao-financeira](https://github.com/joaopedrodeb/api-previsao-financeira), com a configuração de desenvolvimento e seus limites. Os exemplos usam valores fictícios; as interfaces mostradas nas capturas representam ferramentas de exploração, não uma demonstração de todas as operações concluídas.

## O problema: compartilhar dados exige mais que salvar no banco

Imagine que João cadastra uma compra de supermercado no celular. Maria pertence ao mesmo grupo familiar, baixa esse lançamento e corrige sua categoria. Enquanto isso, João, ainda offline, muda o valor da compra.

Aceitar silenciosamente a última requisição faria uma alteração desaparecer. Repetir uma requisição após uma falha de rede poderia criar duas compras. Apagar fisicamente um lançamento poderia impedir um aparelho offline de descobrir que ele foi excluído.

Por isso, o contrato precisa tratar **identidade, autorização, idempotência, versões, histórico e sincronização incremental**. GraphQL oferece uma linguagem para acessar essas capacidades; a consistência vem das regras da aplicação e das transações no banco.

## A arquitetura implementada

```text
Aplicativo da família
  ├── SQLite: lançamentos, fila pendente e cursor por conta/grupo
  ├── Login Google → Cognito → access token
  └── HTTPS → API Gateway HTTP → API .NET 10 na EC2
                                    ├── REST + Swagger
                                    ├── GraphQL + Nitro
                                    └── PostgreSQL: dados e log de mudanças

GitHub Actions → OIDC → IAM Role → ECR / S3 / SSM → EC2
Terraform → definição e estado da infraestrutura AWS
CloudWatch → logs, métricas e alarmes
```

No backend, separei responsabilidades em camadas: **Domain** concentra o domínio; **Application** depende somente do domínio; **Persistence** implementa acesso aos dados; a **Api** compõe os serviços e expõe os contratos. Isso permite mudar detalhes de hospedagem ou persistência sem colocar dependências de nuvem nas entidades.

REST e GraphQL compartilham autenticação e regras de negócio. A cópia SQLite é responsabilidade do aplicativo consumidor; a API fornece o protocolo necessário para mantê-la consistente. A documentação do [fluxo de sincronização](https://github.com/joaopedrodeb/api-previsao-financeira/blob/develop/docs/family-sync.md) detalha o comportamento implementado.

## AWS: o papel de cada serviço

O ambiente DEV está na região **sa-east-1**, São Paulo. A aplicação e o PostgreSQL executam em Docker Compose na mesma **EC2 t4g.micro**, baseada em ARM64/Graviton. Essa escolha reduz a complexidade operacional de um ambiente de desenvolvimento, mas exige imagens compatíveis com ARM64 e concentra aplicação e banco em uma única máquina.

| Serviço | Responsabilidade neste projeto |
| --- | --- |
| EC2 e EBS | Hospedar os containers e manter os dados em armazenamento persistente; o volume EBS é criptografado. |
| API Gateway HTTP | Publicar a entrada HTTPS e encaminhar requisições ao backend; aplicar configuração de CORS e limites de requisições. |
| Cognito User Pool | Validar a identidade usada pela API e federar o login Google já configurado no ambiente. |
| ECR | Armazenar as imagens de container usadas no deploy. |
| Systems Manager | Executar comandos de implantação na instância sem depender de uma sessão SSH manual. |
| Parameter Store | Manter a senha do PostgreSQL como SecureString, fora do código e do estado Terraform. |
| S3 | Guardar artefatos de implantação e recursos previstos para relatórios; o backend Terraform usa armazenamento remoto próprio. |
| CloudWatch | Receber logs e fornecer métricas e alarmes, como CPU e erros da API/Gateway. |
| IAM e STS | Definir permissões e conceder sessões temporárias para workloads e implantação. |

O Terraform também descreve **DynamoDB, SQS e uma DLQ** como base para funcionalidades de relatórios. A sincronização financeira atual persiste em PostgreSQL: ela não publica cada lançamento nessa fila nem grava os lançamentos no DynamoDB. O endpoint REST de relatórios ainda é um esqueleto que retorna `204`; citar um recurso de infraestrutura não significa que toda a funcionalidade correspondente esteja pronta.

Há um detalhe importante na fronteira de rede: o Gateway recebe HTTPS, mas a integração atual encaminha para o backend em **HTTP na porta 8080**. A captura do Nitro mostra um acesso direto à EC2 usado no DEV. Para enviar credenciais, o consumidor deve usar a entrada HTTPS autorizada. Uma evolução de segurança é restringir o acesso direto à origem e proteger também esse trecho de rede; o HTTPS público, sozinho, não torna toda a comunicação interna criptografada.

Também não se trata de uma arquitetura de alta disponibilidade: não há RDS, balanceador ou banco Multi-AZ neste desenho. Custos dependem dos recursos provisionados, armazenamento, logs e tráfego; até componentes ainda não utilizados pela funcionalidade devem entrar na revisão de custos.

## Terraform: infraestrutura que pode ser revisada

Terraform descreve o estado desejado em arquivos HCL. O provider conversa com a AWS; o **state** relaciona os recursos declarados aos objetos existentes; o **plan** mostra a diferença antes de uma aplicação. Isso transforma uma configuração feita no console em uma mudança que pode ser comparada e revisada no repositório.

No projeto, essa definição inclui rede, instância, repositório de imagens, Gateway, políticas IAM e observabilidade. Variáveis distinguem parâmetros de ambiente de decisões estruturais. O estado remoto no S3 usa criptografia e bloqueio para evitar duas alterações concorrentes; habilitar versionamento no bucket ajuda na recuperação do próprio state. O estado continua sendo um material sensível, mesmo quando a senha do banco é gerenciada separadamente. Veja a [documentação do backend S3](https://developer.hashicorp.com/terraform/language/backend/s3).

O requisito geral do projeto é Terraform `>= 1.8`, mas o backend atual usa `use_lockfile`, disponível a partir da versão **1.10**, conforme o [guia de backends da AWS](https://docs.aws.amazon.com/prescriptive-guidance/latest/terraform-aws-provider-best-practices/backend.html). Para trabalhar com essa configuração, use uma CLI compatível, em vez de assumir que qualquer versão acima de 1.8 atende a todos os arquivos.

Um fluxo de revisão, em uma cópia configurada para sua própria conta, é:

```powershell
aws sso login --profile finance-dev
$env:AWS_PROFILE = "finance-dev"
terraform -chdir=iac/terraform fmt -check -recursive
terraform -chdir=iac/terraform init
terraform -chdir=iac/terraform validate
terraform -chdir=iac/terraform plan -var-file="dev.tfvars"
```

Antes do `init`, adapte o backend para um bucket e uma chave de estado sob sua administração. Configure os IDs externos exigidos pelo projeto, como VPC/subnet, Cognito e provedor OIDC. Não reutilize o backend de outra pessoa. Quando recursos já existem, planeje sua importação e a migração de responsabilidade antes de aplicar mudanças: recriar infraestrutura sem reconhecer o que já está provisionado pode causar perda ou indisponibilidade.

O `plan` precisa de credenciais válidas e pode conter informações sensíveis. A aplicação é uma decisão operacional posterior à revisão; não faz parte de executar os exemplos GraphQL. O [guia de implantação DEV](https://github.com/joaopedrodeb/api-previsao-financeira/blob/develop/docs/deployment-dev.md) reúne os detalhes específicos do repositório.

## REST e GraphQL: por que manter os dois?

REST organiza uma interface em torno de recursos e das semânticas HTTP. Uma consulta como `GET /api/Users/{id}` tem um caminho explícito; métodos, status e representação da resposta fazem parte do contrato. Em uma API REST bem desenhada, GET consulta sem provocar uma alteração de negócio e PUT ou DELETE podem ter comportamento idempotente. A semântica dos métodos está documentada no [padrão HTTP](https://www.rfc-editor.org/rfc/rfc9110.html).

GraphQL publica um schema tipado e permite que o cliente selecione os campos necessários. Uma **query** consulta; uma **mutation** altera; uma **subscription** oferece um fluxo de notificações quando o transporte suporta isso. Os argumentos são tipados e as variáveis deixam a operação separada dos valores enviados. Essa seleção pode reduzir viagens de rede e dados desnecessários em telas que combinam usuário, grupos e lançamentos. Veja a [introdução oficial a queries e mutations](https://graphql.org/learn/queries/).

| Aspecto | REST | GraphQL |
| --- | --- | --- |
| Contrato | Rotas, métodos, payloads e status HTTP | Schema com tipos, campos, argumentos e operações |
| Seleção da resposta | Representação definida por endpoint | Campos selecionados pelo consumidor |
| Documentação interativa | OpenAPI e Swagger UI | Schema, introspecção e ferramentas como Nitro |
| Erros | Status HTTP e corpo conforme o contrato | Erros de transporte e `errors` no envelope GraphQL, inclusive com HTTP 200 |
| Cache | Pode aproveitar as semânticas HTTP | Precisa considerar operação, variáveis, identidade e cache do cliente |

Na implementação atual, REST mantém `/auth`, `/version`, health checks e o cadastro da própria conta em `/api/Users`. GraphQL concentra grupos, convites, lançamentos, histórico e sincronização. As consultas de usuários REST não são um diretório público: cada usuário vê somente sua própria conta.

Isso preserva os usos existentes e oferece um contrato adequado ao novo aplicativo. Não há obrigação de transformar toda operação em GraphQL. Também não existe isolamento automático porque o schema é tipado: a autorização é verificada pela aplicação para cada grupo e operação. Essa separação segue o princípio descrito na [documentação GraphQL sobre autorização](https://graphql.org/learn/authorization/).

## Swagger e Nitro: duas portas para explorar a API

<figure>
  <img src="images/artigos/Captura%20de%20tela%202026-10-02%20091005.png" alt="Swagger UI do projeto mostrando os endpoints REST Auth, version e Reports." loading="lazy" />
  <figcaption>Swagger UI: exploração dos contratos HTTP da parte REST.</figcaption>
</figure>

Swagger não lista automaticamente cada query e mutation como uma rota. No GraphQL, diferentes operações chegam a `/graphql`, e o schema é a referência para navegar nos campos.

<figure>
  <img src="images/artigos/Captura%20de%20tela%202026-10-02%20090933.png" alt="Tela inicial do Nitro com as opções Create Document e Browse Schema para explorar o GraphQL." loading="lazy" />
  <figcaption>Nitro: interface para criar operações e navegar no schema GraphQL. A captura foi feita em um acesso de diagnóstico ao DEV.</figcaption>
</figure>

A interface **Nitro**, integrada ao Hot Chocolate, está em `/graphql/ui`. No ambiente `Development`, a página abre sem token; execução de queries, introspecção e download do schema continuam autenticados. O Swagger inclui uma ligação para essa ferramenta. Em `Production`, a interface de exploração não é publicada.

Para utilizar, obtenha seu access token pelo login autorizado, abra a interface na entrada HTTPS do DEV, configure o header `Authorization: Bearer <access_token>` e execute uma consulta. A introspecção passa a mostrar os campos e argumentos disponíveis. Não publique capturas que contenham esse header. A [documentação do Hot Chocolate](https://chillicream.com/docs/hotchocolate/server/endpoints) explica a integração dos endpoints e do Nitro.

## IAM e Cognito: quem precisa de qual acesso?

Existem dois públicos diferentes. **Quem administra a AWS** precisa de permissões na conta para infraestrutura, logs ou implantação. **Quem usa o aplicativo** precisa de uma identidade no Cognito e de participação no grupo familiar. Um familiar não precisa de uma conta IAM para lançar despesas.

Para um colaborador de infraestrutura, o administrador deve conceder uma identidade individual, preferencialmente pelo **IAM Identity Center** ou pela federação já adotada pela organização. Ele entrega o endereço do portal de acesso, identifica a conta e atribui um conjunto de permissões adequado à tarefa, com MFA. A pessoa configura seu próprio perfil:

```powershell
aws configure sso --profile finance-dev
aws sso login --profile finance-dev
aws sts get-caller-identity --profile finance-dev
```

Se a organização ainda usa usuários IAM, o provisionamento também deve ser individual e com permissões limitadas. Compartilhar o login root, senhas ou chaves permanentes não é um requisito da integração. A AWS recomenda federação, credenciais temporárias e privilégio mínimo em suas [boas práticas de IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html).

O deploy do projeto usa uma terceira identidade: o **GitHub Actions assume uma IAM Role por OIDC**. A confiança restringe o repositório e o Environment `development`; a execução obtém credenciais temporárias para ECR, artefatos e SSM. O workflow DEV é manual, enquanto o CI valida as alterações. Não é necessário gravar uma access key permanente no GitHub. Veja o [fluxo oficial de OIDC com AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws).

## Como cadastrar e convidar os usuários do aplicativo

O login Google é federado pelo Cognito já existente. Para integrar um novo aplicativo, seu responsável deve receber a URL HTTPS da API, o domínio de login Cognito e a configuração pública do App Client. Callback, logout e scopes precisam estar autorizados nesse cliente. O projeto não cria nem altera automaticamente o User Pool ou o provedor Google.

Em um cliente mobile ou web público, use **Authorization Code com PKCE**, `state` e callbacks previamente cadastrados. Não distribua um client secret dentro do aplicativo. Solicite `openid email profile` dentro dos scopes permitidos. O [endpoint de autorização Cognito](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html) documenta esse fluxo.

Após o login, envie o **access token**, e não o ID token, para a API. O backend verifica assinatura, emissor, validade, `token_use=access` e `client_id`. Obtém o perfil via `/oauth2/userInfo`, verifica o vínculo com o `sub` e exige email verificado do domínio `gmail.com`. O [endpoint userInfo](https://docs.aws.amazon.com/cognito/latest/developerguide/userinfo-endpoint.html) fornece o perfil conforme os scopes. O fallback `GetUser` requer `aws.cognito.signin.user.admin`.

Na primeira consulta válida a `me`, a API cria o cadastro local ou vincula um cadastro legado ainda sem identidade Cognito. O autor das alterações vem dessa identidade validada; o cliente não escolhe livremente quem fez o lançamento.

O fluxo familiar é:

1. O primeiro membro faz login e executa `me` e `createGroup`.
2. Ele se torna `OWNER` e convida outro Gmail verificado com `inviteMember`.
3. O convidado faz seu próprio login, consulta `myInvites` e usa `acceptInvite`.
4. Ambos passam a consultar o grupo pelas permissões concedidas.

Os convites duram sete dias e são encontrados no aplicativo: a implementação atual **não envia email de convite**. `OWNER` gerencia membros e edita os lançamentos; `EDITOR` também pode criar, editar e excluir qualquer lançamento do grupo; `VIEWER` apenas consulta. Remover um membro revoga seu acesso; o proprietário não pode ser removido.

## Integração: a primeira chamada GraphQL

Depois de obter o token pelo fluxo de login, esta consulta retorna a própria conta e os grupos:

```graphql
query IniciarAplicativo {
  me { id name email }
  myGroups { id name }
}
```

Um cliente JavaScript pode enviar a operação assim:

```javascript
async function executarGraphQL(apiBase, accessToken, query, variables = {}) {
  const response = await fetch(`${apiBase.replace(/\/$/, '')}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({ query, variables })
  });

  if (!response.ok) throw new Error(`Falha HTTP: ${response.status}`);
  const result = await response.json();
  // Preserve data e errors: GraphQL pode devolver resultados parciais.
  return { data: result.data, errors: result.errors ?? [] };
}
```

O consumidor precisa inspecionar `errors`, mesmo com HTTP 200. Um token expirado pede renovação pelo provedor; uma recusa de acesso não deve provocar retries infinitos. Guarde tokens no mecanismo seguro apropriado à plataforma e nunca os registre nos logs.

No navegador, configure o CORS para a origem real do aplicativo: o DEV tem origens locais configuradas, não uma autorização universal para qualquer site. CORS controla acesso pelo navegador, não substitui a verificação de identidade e grupo. O schema completo e versionado está em [docs/graphql/schema.graphql](https://github.com/joaopedrodeb/api-previsao-financeira/blob/develop/docs/graphql/schema.graphql).

## Sincronização offline: fila, cursor e conflitos

A criação de um lançamento recebe um `clientId` gerado no aparelho e um `clientMutationId` que identifica a operação. Gere esses valores antes de persistir a fila local e mantenha-os nas tentativas seguintes. O servidor reserva o `clientId` dentro do grupo e reconhece retries pela chave de idempotência; a mesma chave com um payload diferente é recusada.

Uma atualização exige `expectedVersion`. Se dois aparelhos partiram da versão 3, a primeira alteração produz a versão 4; a segunda encontra um conflito e recebe o estado atual. O aplicativo deve mostrar essa divergência ou aplicar uma política explícita de resolução, em vez de sobrescrever dados sem decisão.

```graphql
mutation Sincronizar($input: SyncChangesInput!) {
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

As variáveis incluem `groupId`, `deviceId`, `sinceCursor` e `changes`. Este exemplo cria uma despesa; substitua o `groupId` pelo ID real de um grupo ao qual sua conta pertence:

```json
{
  "input": {
    "groupId": "11111111-1111-4111-8111-111111111111",
    "deviceId": "celular-demo",
    "sinceCursor": null,
    "changes": [{
      "clientId": "celular-demo-compra-001",
      "clientMutationId": "celular-demo-operacao-001",
      "operation": "CREATED",
      "description": "Supermercado",
      "amount": -245.90,
      "category": "Alimentação",
      "entryType": "DESPESA",
      "occurredAt": "2026-10-02T12:00:00Z"
    }]
  }
}
```

Para atualizar, envie `operation: "UPDATED"`, o mesmo `clientId`, uma **nova** chave de operação e `expectedVersion` obtida do servidor. Para excluir, use `"DELETED"` e também informe a versão esperada. Uma nova ação recebe uma nova chave; um retry preserva a chave original. O `deviceId` é identificação operacional, não prova de identidade.

O primeiro download pode enviar uma fila vazia. Cada chamada aceita até **100 operações locais** e devolve até **500 mudanças remotas**. Os resultados têm funções distintas:

| Campo | O que o aplicativo deve fazer |
| --- | --- |
| `applied` | Reconhecer operações aceitas e atualizar os IDs/versões locais. |
| `conflicts` | Guardar o conflito e apresentar o estado do servidor para resolução. |
| `rejected` | Exibir ou corrigir a causa; não reenviar indefinidamente sem mudança. |
| `changes` | Aplicar snapshots remotos na ordem entregue, incluindo exclusões. |
| `nextCursor` e `hasMore` | Persistir o progresso e buscar os próximos lotes quando necessário. |

Uma operação inválida não desfaz as operações válidas do lote. Aplique as mudanças e salve o cursor **na mesma transação SQLite**: salvar só o cursor pode fazer o aparelho pular informações após uma interrupção. Ignore snapshots anteriores à versão local e separe o cache por conta e grupo. Na troca de usuário, os dados da conta anterior devem ser removidos ou isolados.

Os valores financeiros usam `decimal(18,2)`: `DESPESA` é negativa, `RENDA` positiva e zero é recusado. Evite calcular dinheiro com ponto flutuante binário no cliente; centavos inteiros ou uma biblioteca decimal ajudam. Datas são normalizadas para UTC; a data da compra pode ser retroativa, mas os horários de criação e alteração vêm do servidor.

Exclusão é lógica: o servidor conserva `deletedAt` e um snapshot de exclusão, o **tombstone**. Isso permite que um aparelho offline descubra a remoção. `recentActions` mostra quem criou, editou ou excluiu lançamentos e quando; é histórico financeiro, não um registro completo de logins ou de toda ação administrativa.

## Notificações e os limites do transporte

O backend também implementa `expenseChanged` com `graphql-transport-ws`. A subscription consulta o log durável a cada dois segundos, verifica a participação no grupo e encerra quando o token expira. O cursor pode ajudar a recuperar o intervalo na reconexão.

Porém, o **API Gateway HTTP usado no projeto não transporta o upgrade WebSocket**. Pela URL pública desse Gateway, o aplicativo deve usar `syncChanges` ou `changes` por HTTP, periodicamente e ao voltar ao primeiro plano. Para subscriptions públicas, será necessário um caminho de rede compatível com WebSocket e TLS. Criar uma API Gateway WebSocket separada não equivale a um proxy transparente do protocolo existente.

Notificações ajudam a reduzir a espera, mas a recuperação pelo log e pelo cursor é o que permite reconstruir a cópia local depois de uma desconexão.

## Executar localmente e validar a implementação

Para estudar o backend, clone o repositório e siga o README para as variáveis de ambiente do Compose. Você precisa do SDK .NET 10, Docker e das ferramentas locais. Credenciais e configurações de identidade dependem do ambiente autorizado; não existe um token compartilhado no código.

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

Os testes de integração usam um PostgreSQL descartável em Docker e JWTs assinados localmente, sem recursos AWS reais. Exercitam o contrato, autorização, sincronização e WebSocket, além de comparar o schema publicado com o executável. A validação do projeto também contempla builds Docker AMD64/ARM64, migrations idempotentes e configuração Terraform.

A migration acrescenta grupos, membros, convites, lançamentos, log e recibos de idempotência preservando os usuários existentes. Em Production, migrations exigem o processo operacional definido; não são aplicadas automaticamente na inicialização.

## Decisões que precisam evoluir com o uso

Para ordenar os commits e a entrega dos cursores, a implementação usa um **advisory lock transacional global no PostgreSQL**. É uma estratégia conservadora contra perda de mudanças por commits fora de ordem, mas serializa operações de todos os grupos, inclusive leituras. Aumentar o volume exige medir a contenção e redesenhar o particionamento de locks e cursores.

Recibos de idempotência e tombstones não expiram automaticamente. Isso protege retries e aparelhos offline, mas cresce o armazenamento. Uma retenção futura precisa definir como um cliente muito antigo realiza uma ressincronização completa.

Outras evoluções incluem validar backup e restauração, separar banco e aplicação quando necessário, proteger a origem, revisar permissões IAM existentes e definir limites de custo de execução das consultas GraphQL. Hospedar na AWS não elimina essas decisões; ter Terraform, testes e logs torna mais fácil explicitá-las e revisá-las.

## O que encaminhar a quem vai integrar

Para um desenvolvedor do aplicativo, entregue **a URL HTTPS do ambiente autorizado**, a configuração pública Cognito, o callback aprovado, este artigo e o schema. Ele deve fazer seu próprio login Google, criar ou aceitar um grupo e testar consultas e sincronização com dados fictícios. Não encaminhe senhas AWS, access tokens ou segredos de infraestrutura.

Para alguém que vai operar o ambiente, adicione o acesso individual ao portal AWS, conta/perfil e permissões combinadas, além do guia de deploy e da localização autorizada do estado e dos parâmetros. Acesso ao console AWS não concede participação em uma família; participação no grupo também não concede administração da nuvem.

O benefício principal desse projeto é unir uma experiência compartilhada para a família a um backend que explicita as regras de identidade, consistência e operação. REST preserva contratos úteis, GraphQL organiza a interação do aplicativo e Terraform mantém a infraestrutura revisável. O aprendizado está tanto nas tecnologias quanto nas decisões necessárias para que elas funcionem juntas.
