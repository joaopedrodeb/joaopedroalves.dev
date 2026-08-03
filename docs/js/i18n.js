const DEFAULT_LANG = 'pt';
const LANG_STORAGE_KEY = 'portfolio-language';

const getStoredLanguage = () => {
  const params = new URLSearchParams(window.location.search);
  const paramLang = params.get('lang');
  if (paramLang === 'pt' || paramLang === 'en') {
    return paramLang;
  }

  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    if (stored === 'pt' || stored === 'en') return stored;
  } catch (error) {
    console.warn('Unable to access localStorage for language preference.', error);
  }

  const browserLang = (navigator.language || '').toLowerCase();
  return browserLang.startsWith('en') ? 'en' : 'pt';
};

const setLanguage = (lang) => {
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch (error) {
    console.warn('Unable to persist language preference.', error);
  }
  const currentLang = lang === 'en' ? 'en' : 'pt';
  document.body.dataset.lang = currentLang;

  const signals = document.querySelectorAll('[data-i18n]');
  signals.forEach((node) => {
    const key = node.dataset.i18n;
    const value = getTranslation(currentLang, key);
    if (value) {
      if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') {
        node.placeholder = value;
      } else {
        node.textContent = value;
      }
    }
  });

  const langButtons = document.querySelectorAll('[data-lang-switch]');
  langButtons.forEach((button) => {
    const isActive = button.dataset.langSwitch === currentLang;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });

  document.dispatchEvent(new CustomEvent('languagechange', { detail: { lang: currentLang } }));
};

const getTranslation = (lang, key) => {
  const fallback = translations[DEFAULT_LANG];
  const items = translations[lang] || fallback;
  const value = key.split('.').reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), items);
  return value ?? key;
};

const translations = {};

const loadTranslations = async () => {
  const response = await fetch('./data/i18n.json', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Could not load translation file.');
  }
  const data = await response.json();
  Object.assign(translations, data);
  const preferred = getStoredLanguage();
  setLanguage(preferred);
};

window.i18n = {
  getStoredLanguage,
  setLanguage,
  loadTranslations,
  getTranslation,
  DEFAULT_LANG,
};
