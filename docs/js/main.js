const BASE_PATH = window.location.pathname.includes('/joaopedroalves.dev') ? '/joaopedroalves.dev' : '';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function updateActiveNav() {
  const currentHash = window.location.hash || '#top';
  const navLinks = document.querySelectorAll('.nav a');
  navLinks.forEach((link) => {
    const match = link.getAttribute('href') === currentHash || link.getAttribute('href') === currentHash.replace('#', '');
    link.classList.toggle('active', !!match);
  });
}

function setCurrentYear() {
  const yearNode = document.getElementById('year');
  if (yearNode) yearNode.textContent = new Date().getFullYear();
}

function initNavigation() {
  const menuToggle = document.getElementById('mobile-menu-toggle');
  const nav = document.getElementById('site-nav');

  if (menuToggle && nav) {
    menuToggle.addEventListener('click', () => {
      nav.classList.toggle('open');
      const expanded = menuToggle.getAttribute('aria-expanded') === 'true';
      menuToggle.setAttribute('aria-expanded', String(!expanded));
    });
  }

  document.querySelectorAll('.nav a').forEach((link) => {
    link.addEventListener('click', () => {
      if (nav) nav.classList.remove('open');
    });
  });
}

function initBackToTop() {
  const button = document.getElementById('back-to-top');
  if (!button) return;

  const updateVisibility = () => {
    button.classList.toggle('visible', window.scrollY > 360);
  };

  updateVisibility();
  window.addEventListener('scroll', updateVisibility, { passive: true });
  button.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

function initAnimatedWords() {
  const wordTarget = document.getElementById('animated-words');
  if (!wordTarget) return;

  const words = ['APIs', 'Microservices', 'Distributed Systems', 'Event-Driven Architecture', 'Cloud', 'Generative AI'];
  let index = 0;

  const updateWord = () => {
    wordTarget.textContent = words[index];
    index = (index + 1) % words.length;
  };

  updateWord();
  setInterval(updateWord, 1800);
}

function initLanguageSwitchButtons() {
  document.querySelectorAll('[data-lang-switch]').forEach((button) => {
    button.addEventListener('click', () => {
      const lang = button.dataset.langSwitch;
      window.i18n?.setLanguage(lang);
      const url = new URL(window.location.href);
      url.searchParams.set('lang', lang);
      window.history.replaceState({}, '', url);
    });
  });
}

function applyTextContentFromData() {
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const key = node.dataset.i18n;
    const lang = document.body.dataset.lang || 'pt';
    const translation = window.i18n?.getTranslation?.(lang, key) || key;
    if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') {
      node.placeholder = translation;
    } else {
      node.textContent = translation;
    }
  });
}

async function initPortfolio() {
  try {
    await window.i18n?.loadTranslations?.();
    applyTextContentFromData();
    initLanguageSwitchButtons();
  } catch (error) {
    console.error('Unable to initialize portfolio language:', error);
  }

  setCurrentYear();
  updateActiveNav();
  initNavigation();
  initBackToTop();
  initAnimatedWords();
}

document.addEventListener('DOMContentLoaded', initPortfolio);
window.addEventListener('hashchange', updateActiveNav);
