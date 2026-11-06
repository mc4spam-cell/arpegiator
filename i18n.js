// Système multilingue d'Arpegiator. Copié de Harmonie, STORE propre à ce projet.
// API : window.i18n.t(key), .setLang(code), .LANGS, .lang, .apply(root), .isRTL().
// Les éléments statiques utilisent data-i18n="clé" ou data-i18n-attr="attr:clé,…".
// Les scripts applicatifs écoutent window.addEventListener('langchange', …).

(() => {
  'use strict';

  const LANGS = [
    { code: 'en', flag: '🇬🇧', name: 'English' },
    { code: 'zh', flag: '🇨🇳', name: '中文' },
    { code: 'hi', flag: '🇮🇳', name: 'हिन्दी' },
    { code: 'es', flag: '🇪🇸', name: 'Español' },
    { code: 'fr', flag: '🇫🇷', name: 'Français' },
    { code: 'ar', flag: '🇸🇦', name: 'العربية' },
    { code: 'bn', flag: '🇧🇩', name: 'বাংলা' },
    { code: 'pt', flag: '🇧🇷', name: 'Português' },
    { code: 'ru', flag: '🇷🇺', name: 'Русский' },
    { code: 'ur', flag: '🇵🇰', name: 'اردو' },
  ];
  const RTL = new Set(['ar', 'ur']);
  const STORE = 'arpegiator.lang';
  const FALLBACK = 'en';
  const DEFAULT = 'fr';

  const DICT = {};
  window.__i18nAdd = (code, obj) => { DICT[code] = Object.assign(DICT[code] || {}, obj); };

  let current = DEFAULT;
  try {
    const saved = localStorage.getItem(STORE);
    if (saved && LANGS.find(l => l.code === saved)) current = saved;
  } catch (e) { /* stockage indisponible */ }

  function t(key, ...args) {
    let s = (DICT[current] && DICT[current][key])
         || (DICT[FALLBACK] && DICT[FALLBACK][key])
         || key;
    for (let i = 0; i < args.length; i++) s = s.replace('%' + (i + 1), args[i]);
    return s;
  }

  function apply(root) {
    (root || document).querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    (root || document).querySelectorAll('[data-i18n-attr]').forEach(el => {
      for (const pair of el.getAttribute('data-i18n-attr').split(',')) {
        const [attr, key] = pair.split(':').map(s => s.trim());
        if (attr && key) el.setAttribute(attr, t(key));
      }
    });
  }

  function setLang(code) {
    if (!LANGS.find(l => l.code === code)) return;
    current = code;
    try { localStorage.setItem(STORE, code); } catch (e) { /* stockage indisponible */ }
    document.documentElement.lang = code;
    document.documentElement.dir = RTL.has(code) ? 'rtl' : 'ltr';
    apply();
    window.dispatchEvent(new Event('langchange'));
  }

  window.i18n = {
    LANGS,
    get lang() { return current; },
    setLang, t, apply,
    isRTL: () => RTL.has(current),
  };

  const init = () => {
    document.documentElement.lang = current;
    document.documentElement.dir = RTL.has(current) ? 'rtl' : 'ltr';
    apply();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
