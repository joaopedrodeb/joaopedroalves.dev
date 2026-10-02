const ARTICLES_DATA_URL = './data/articles.json';

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Request failed for ${url}`);
  return response.json();
}

function sanitizeHtml(value) {
  if (window.DOMPurify) {
    return DOMPurify.sanitize(value, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ['target', 'rel']
    });
  }

  const template = document.createElement('template');
  template.innerHTML = value;
  return template.innerHTML;
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function slugify(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function renderMarkdown(markdown = '') {
  const parsed = typeof marked !== 'undefined' ? marked.parse(markdown) : markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return sanitizeHtml(parsed);
}

function buildTocFromArticle(articleContent) {
  const headings = Array.from(articleContent.querySelectorAll('h2, h3'));
  if (!headings.length) return '';

  const usedIds = new Set();
  const items = headings.map((heading) => {
    const text = heading.textContent.trim();
    const base = slugify(text) || 'section';
    let slug = base;
    let suffix = 2;
    while (usedIds.has(slug)) slug = `${base}-${suffix++}`;
    usedIds.add(slug);
    heading.id = slug;
    return `<li><a href="#${slug}">${escapeHtml(text)}</a></li>`;
  }).join('');

  return `<h3>${window.i18n?.getTranslation?.(document.body.dataset.lang || 'pt', 'articles.toc') || 'Quick navigation'}</h3><ol>${items}</ol>`;
}

function renderFeaturedArticle(articles, lang) {
  const container = document.getElementById('featured-article');
  if (!container) return;
  const article = articles.filter((item) => item.featured && item.status === 'published')
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))[0];
  container.hidden = !article;
  if (!article) return;
  const title = article.title[lang] || article.title.pt;
  const description = article.description[lang] || article.description.pt;
  container.innerHTML = `
    <article class="featured-article card">
      <img src="${escapeHtml(article.image)}" alt="${escapeHtml(title)}" width="640" height="360" loading="lazy" />
      <div class="featured-article-content">
        <span class="badge">${lang === 'en' ? 'Project in focus · Case study' : 'Projeto em evidência · Estudo de caso'}</span>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(description)}</p>
        <div class="article-meta">${article.tags.map((tag) => `<span class="article-tag">${escapeHtml(tag)}</span>`).join('')}</div>
        <a class="button primary" href="article.html?slug=${encodeURIComponent(article.slug)}&lang=${lang}">${lang === 'en' ? 'Explore the project' : 'Conhecer o projeto'} →</a>
      </div>
    </article>`;
}

async function loadArticlesList() {
  const listElement = document.getElementById('articles-list');
  if (!listElement) return;

  try {
    const articles = await fetchJson(ARTICLES_DATA_URL);
    const lang = document.body.dataset.lang || 'pt';
    renderFeaturedArticle(articles, lang);
    const searchTerm = (document.getElementById('article-search')?.value || '').trim().toLowerCase();
    const selectedTag = document.getElementById('article-tag-filter')?.value || 'all';
    const sortValue = document.getElementById('article-sort')?.value || 'newest';

    const filtered = articles.filter((article) => {
      if (article.status && !['published', 'draft'].includes(article.status)) {
        return false;
      }

      const title = (article.title?.[lang] || article.title?.pt || article.title?.en || '').toLowerCase();
      const description = (article.description?.[lang] || article.description?.pt || article.description?.en || '').toLowerCase();
      const matchesSearch = !searchTerm || title.includes(searchTerm) || description.includes(searchTerm);
      const tags = article.tags || [];
      const matchesTag = selectedTag === 'all' || tags.includes(selectedTag);
      return matchesSearch && matchesTag;
    }).sort((a, b) => {
      const left = new Date(a.publishedAt || 0).getTime();
      const right = new Date(b.publishedAt || 0).getTime();
      return sortValue === 'oldest' ? left - right : right - left;
    });

    const allTags = [...new Set(articles.flatMap((article) => article.tags || []))];
    const tagFilter = document.getElementById('article-tag-filter');
    if (tagFilter) {
      const currentValue = tagFilter.value || 'all';
      tagFilter.innerHTML = [`<option value="all">${window.i18n?.getTranslation?.(lang, 'articles.all') || 'All'}</option>`].concat(
        allTags.map((tag) => `<option value="${tag}">${tag}</option>`)
      ).join('');
      tagFilter.value = allTags.includes(currentValue) ? currentValue : 'all';
    }

    if (!filtered.length) {
      listElement.innerHTML = `<div class="card"><p>${window.i18n?.getTranslation?.(lang, 'articles.empty') || 'No articles found for this filter.'}</p></div>`;
      return;
    }

    listElement.innerHTML = filtered.map((article) => {
      const title = article.title?.[lang] || article.title?.pt || article.title?.en || 'Untitled';
      const description = article.description?.[lang] || article.description?.pt || article.description?.en || '';
      const published = new Date(article.publishedAt || Date.now()).toLocaleDateString(lang === 'en' ? 'en-US' : 'pt-BR', { timeZone: 'UTC' });
      const image = article.image || 'images/artigos/placeholder.svg';
      const tags = (article.tags || []).slice(0, 3).map((tag) => `<span class="article-tag">${tag}</span>`).join('');
      const draftLabel = article.status === 'draft' ? `<span class="badge">${window.i18n?.getTranslation?.(lang, 'articles.draft') || 'Draft'}</span>` : '';
      const featuredLabel = article.featured ? `<span class="badge">${window.i18n?.getTranslation?.(lang, 'articles.featured') || 'Featured'}</span>` : '';
      return `
        <article class="card article-card">
          <img class="article-image" src="${image}" alt="${title}" loading="lazy" width="640" height="360" onerror="this.onerror=null;this.src='images/articles/placeholder.svg';" />
          <div class="article-content">
            <div class="meta-row">
              <span>${published}</span>
              <span>${article.readingTime || 5} ${window.i18n?.getTranslation?.(lang, 'articles.readingTime') || 'min read'}</span>
            </div>
            <div class="article-meta">${draftLabel}${featuredLabel}${tags}</div>
            <h3>${title}</h3>
            <p>${description}</p>
            <a class="read-more" href="article.html?slug=${article.slug}&lang=${lang}">${window.i18n?.getTranslation?.(lang, 'articles.readMore') || 'Read more'} →</a>
          </div>
        </article>
      `;
    }).join('');
  } catch (error) {
    console.error('Error loading articles listing:', error);
    if (listElement) listElement.innerHTML = '<div class="card"><p>Unable to load articles.</p></div>';
  }
}

async function loadArticlePage(requestedLang) {
  const articleRoot = document.getElementById('article-content');
  if (!articleRoot) return;

  const params = new URLSearchParams(window.location.search);
  const slug = params.get('slug');
  const preferredLang = requestedLang || params.get('lang') || document.body.dataset.lang;
  const lang = preferredLang === 'en' ? 'en' : 'pt';

  try {
    const articles = await fetchJson(ARTICLES_DATA_URL);
    const article = articles.find((item) => item.slug === slug);
    if (!article) {
      articleRoot.innerHTML = '<p>Article not found.</p>';
      return;
    }

    const articlePath = article.content?.[lang] || article.content?.pt || article.content?.en;
    const response = await fetch(articlePath);
    if (!response.ok) throw new Error(`Unable to load article: ${response.status}`);
    const markdown = await response.text();
    const html = renderMarkdown(markdown);
    const articleStatusLabel = article.status === 'draft' ? (lang === 'en' ? 'Draft' : 'Rascunho') : (lang === 'en' ? 'Published' : 'Publicado');

    const title = article.title?.[lang] || article.title?.pt || article.title?.en || 'Untitled';
    document.title = `${title} | João Pedro Alves`;

    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) metaDescription.setAttribute('content', article.description?.[lang] || article.description?.pt || article.description?.en || '');

    const canonical = document.querySelector('link[rel="canonical"]');
    const pageUrl = new URL('article.html', canonical?.href || window.location.href);
    pageUrl.search = new URLSearchParams({ slug: article.slug, lang }).toString();
    if (canonical) canonical.href = pageUrl.href;
    const structuredData = document.querySelector('script[type="application/ld+json"]');
    if (structuredData) structuredData.textContent = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Article', headline: title,
      description: article.description?.[lang] || article.description?.pt,
      datePublished: article.publishedAt, dateModified: article.updatedAt,
      inLanguage: lang === 'en' ? 'en' : 'pt-BR',
      image: new URL(article.image, pageUrl).href,
      author: { '@type': 'Person', name: 'João Pedro Alves' },
      mainEntityOfPage: pageUrl.href
    });

    const articleHtml = `
      <div class="article-meta">
        <span class="badge">${articleStatusLabel}</span>
        ${(article.tags || []).map((tag) => `<span class="article-tag">${tag}</span>`).join('')}
      </div>
      <h1>${title}</h1>
      <div class="meta-row">
        <span>${new Date(article.publishedAt).toLocaleDateString(lang === 'en' ? 'en-US' : 'pt-BR', { timeZone: 'UTC' })}</span>
        <span>${article.readingTime || 5} ${window.i18n?.getTranslation?.(lang, 'articles.readingTime') || 'min read'}</span>
      </div>
      <div class="article-layout">
        <div class="article-shell">
          <article>${html}</article>
        </div>
        <aside class="toc" id="article-toc"></aside>
      </div>
    `;

    articleRoot.innerHTML = articleHtml;
    const renderedArticle = articleRoot.querySelector('.article-shell article');
    document.getElementById('article-toc').innerHTML = buildTocFromArticle(renderedArticle);
    renderedArticle.querySelectorAll('table').forEach((table) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'article-table';
      table.before(wrapper);
      wrapper.append(table);
    });

    const shareButton = document.getElementById('share-button');
    if (shareButton) {
      shareButton.textContent = lang === 'en' ? 'Share' : 'Compartilhar';
      shareButton.onclick = async () => {
        const shareUrl = window.location.href;
        if (navigator.share) {
          await navigator.share({ title, text: title, url: shareUrl });
        } else if (navigator.clipboard) {
          await navigator.clipboard.writeText(shareUrl);
          shareButton.textContent = lang === 'en' ? 'Copied!' : 'Copiado!';
        }
      };
    }
    const backButton = document.getElementById('back-to-articles');
    if (backButton) {
      backButton.textContent = lang === 'en' ? 'Back to articles' : 'Voltar para artigos';
      backButton.href = `index.html?lang=${lang}#articles`;
    }
  } catch (error) {
    console.error('Error loading article:', error);
    articleRoot.innerHTML = '<p>Unable to load this article.</p>';
  }
}

function bindArticleFilters() {
  const searchInput = document.getElementById('article-search');
  const tagFilter = document.getElementById('article-tag-filter');
  const sortControl = document.getElementById('article-sort');

  [searchInput, tagFilter, sortControl].forEach((element) => {
    if (element) {
      element.addEventListener('input', loadArticlesList);
      element.addEventListener('change', loadArticlesList);
    }
  });
}

document.addEventListener('languagechange', (event) => {
  loadArticlesList();
  loadArticlePage(event.detail?.lang);
});

document.addEventListener('DOMContentLoaded', () => {
  bindArticleFilters();
  loadArticlesList();
  loadArticlePage();
});
