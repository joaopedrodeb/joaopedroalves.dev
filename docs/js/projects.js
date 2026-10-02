async function loadProjects() {
  const projectsContainer = document.getElementById('projects-list');
  if (!projectsContainer) return;

  try {
    const response = await fetch('./data/projects.json');
    if (!response.ok) throw new Error('Failed to load project data.');
    const projects = await response.json();

    const lang = document.body.dataset.lang || 'pt';
    const featuredProjects = projects.filter((project) => project.featured);

    if (!featuredProjects.length) {
      projectsContainer.innerHTML = `<p class="small-text">${window.i18n?.getTranslation?.(lang, 'projects.empty') || 'No projects found.'}</p>`;
      return;
    }

    projectsContainer.innerHTML = featuredProjects.map((project) => {
      const title = project.title?.[lang] ?? project.title?.pt ?? project.title?.en ?? 'Untitled';
      const description = project.description?.[lang] ?? project.description?.pt ?? project.description?.en ?? '';
      const repository = project.repository;
      const demo = project.demo;
      const techPills = (project.technologies || []).map((item) => `<span class="project-tag">${item}</span>`).join('');

      return `
        <article class="card project-card">
          <img class="project-image" src="${project.image || 'images/projects/placeholder.svg'}" alt="${title}" loading="lazy" width="640" height="360" onerror="this.onerror=null;this.src='images/projects/placeholder.svg';" />
          <div class="project-content">
            <div class="project-meta">
              <span class="badge">${window.i18n?.getTranslation?.(lang, 'projects.featured') || 'Featured'}</span>
            </div>
            <h3>${title}</h3>
            <p>${description}</p>
            <div class="project-meta">${techPills}</div>
            <div class="project-actions">
              ${repository ? `<a class="button secondary" href="${repository}" target="_blank" rel="noreferrer noopener">${window.i18n?.getTranslation?.(lang, 'projects.repo') || 'Repository'}</a>` : ''}
              ${demo ? `<a class="button secondary" href="${demo}" target="_blank" rel="noreferrer noopener">${window.i18n?.getTranslation?.(lang, 'projects.demo') || 'Demo'}</a>` : ''}
              ${project.article ? `<a class="button secondary" href="article.html?slug=${encodeURIComponent(project.article)}&lang=${lang}">${lang === 'en' ? 'Case study' : 'Estudo de caso'}</a>` : ''}
            </div>
          </div>
        </article>
      `;
    }).join('');
  } catch (error) {
    console.error('Error loading projects:', error);
    projectsContainer.innerHTML = '<p class="small-text">Unable to load projects.</p>';
  }
}

document.addEventListener('languagechange', loadProjects);
window.addEventListener('DOMContentLoaded', loadProjects);
