// Applies settings and the Mac's current look to the document: which theme
// stylesheet is loaded, light or dark, the accent color, the bar height.
// Shared by the bar, the Start menu and the settings preview.
(function () {
  const ACCENTS = {
    blue: ['#007aff', '#0a84ff'],
    purple: ['#af52de', '#bf5af2'],
    pink: ['#ff2d55', '#ff375f'],
    red: ['#ff3b30', '#ff453a'],
    orange: ['#ff9500', '#ff9f0a'],
    yellow: ['#ffcc00', '#ffd60a'],
    green: ['#34c759', '#30d158'],
    graphite: ['#8e8e93', '#98989d']
  };

  function luminance(hex) {
    const n = parseInt(hex.slice(1, 7), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  // Light or dark and the accent color after the settings' "Follow Mac"
  // choices are filled in from the Mac.
  function resolve(state) {
    const { settings, system } = state;
    const appearance = settings.appearance === 'auto' ? system.appearance : settings.appearance;
    const dark = appearance === 'dark';
    const accent = settings.accent === 'auto' ? system.accent : (ACCENTS[settings.accent] || ACCENTS.blue)[dark ? 1 : 0];
    return { appearance, accent, accentText: luminance(accent) > 0.7 ? '#1d1d1f' : '#ffffff' };
  }

  let schemeNames = []; // the scheme variables set last time, to clear on a theme change

  function apply(state) {
    const { settings } = state;
    const root = document.documentElement;
    const { appearance, accent, accentText } = resolve(state);

    const vars = window.schemeVars ? window.schemeVars(settings, { accent, appearance }) : {};
    for (const name of schemeNames) if (!(name in vars)) root.style.removeProperty(name);
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
    schemeNames = Object.keys(vars);

    root.dataset.theme = settings.theme;
    root.dataset.appearance = appearance;
    root.dataset.labels = settings.labels;
    root.dataset.translucent = settings.translucent ? 'on' : 'off';
    root.dataset.startLabel = settings.taskbar.showStartLabel ? 'on' : 'off';
    root.dataset.showDesktop = settings.taskbar.showDesktop ? 'on' : 'off';
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-text', accentText);
    root.style.setProperty('--bar-h', settings.barHeight + 'px');
    root.style.setProperty('--max-button', settings.maxButtonWidth + 'px');

    const link = document.getElementById('theme-css');
    const href = `../themes/${settings.theme}.css`;
    if (link.getAttribute('href') !== href) link.setAttribute('href', href);
  }

  // Plays an element's opening animation again, for windows that are hidden
  // and shown instead of made each time. See "motion" in base.css.
  function playOpen(el) {
    if (!el) return;
    el.classList.remove('opening');
    void el.offsetWidth;
    el.classList.add('opening');
  }
  // Done opening. The rows' own animations bubble up here too, so only the
  // element's own end counts.
  document.addEventListener('animationend', (e) => {
    if (e.target.classList && e.target.classList.contains('opening')) e.target.classList.remove('opening');
  });

  // The same for a list's rows, one after another, when it fills.
  function playRows(el) {
    if (!el) return;
    [...el.children].forEach((c, i) => c.style.setProperty('--i', Math.min(i, 14)));
    el.classList.remove('entering');
    void el.offsetWidth;
    el.classList.add('entering');
  }

  window.applyTheme = apply;
  window.playOpen = playOpen;
  window.playRows = playRows;
  window.resolveTheme = resolve;
  window.ACCENTS = ACCENTS;
})();
