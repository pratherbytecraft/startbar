// The classic themes' color schemes. Each theme's stylesheet reads its colors
// from CSS variables, and schemeVars fills them in from the settings: the
// theme's own `colors` group, plus the accent color and light or dark for a
// scheme named System. Loaded before theme.js, which sets the variables.
(function () {
  function rgb(hex) {
    const n = parseInt(String(hex).replace('#', '').slice(0, 6), 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function hex([r, g, b]) {
    return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  }
  // a moved toward b by t (0 to 1)
  function mix(a, b, t) {
    const x = rgb(a), y = rgb(b);
    return hex(x.map((v, i) => v + (y[i] - v) * t));
  }
  function luminance(c) {
    const [r, g, b] = rgb(c);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  // MARK: Classic 2001

  const XP_KEYS = ['bar1', 'bar2', 'bar3', 'bar4', 'edge', 'text', 'shadow', 'task1', 'task2', 'hover1', 'hover2', 'act1', 'act2', 'actText',
    'tray1', 'tray2', 'trayEdge', 'chev1', 'chev2', 'glyph', 'head1', 'head2', 'headText', 'menuBg', 'menuText', 'col', 'colEdge', 'colText',
    'sel', 'foot1', 'foot2', 'footEdge', 'footText', 'field'];
  const XP_SHADOW = '0 1px 1px rgba(0, 0, 0, .35)';
  const XP = {
    blue: ['#4f85f0', '#3168d5', '#2a5fd0', '#1941a5', '#0c2f8a', '#fff', XP_SHADOW, '#3c81f3', '#2a62d8', '#5a98ff', '#3b74e6', '#1a46b0', '#2b5ed1', '#fff',
      '#139ff9', '#0a7edc', '#0a5fb4', '#4bb1ff', '#1f8ded', '#2a62d8', '#2d6ad8', '#1f52bf', '#fff', '#fff', '#000', '#d3e5fa', '#95bdee', '#1b3f8f',
      '#316ac5', '#4178d6', '#2d5fc4', '#1d4aa8', '#fff', '#7f9db9'],
    olive: ['#d6e1b4', '#b2c287', '#a1b273', '#7f9152', '#5e6e3a', '#fff', '0 1px 1px rgba(0, 0, 0, .4)', '#bccb92', '#96a86b', '#cad8a2', '#a6b87b', '#758748', '#8d9f61', '#fff',
      '#a9ba80', '#8a9c5d', '#6e7f45', '#c0cf96', '#93a466', '#6e7f45', '#9cad72', '#7d8f51', '#fff', '#fff', '#000', '#e9eed8', '#c3cf9e', '#4f5e2c',
      '#93a565', '#a6b67c', '#889a5b', '#6e7f45', '#fff', '#a7b38a'],
    silver: ['#ffffff', '#e3e5ee', '#ccd0de', '#a9afc4', '#8a90a8', '#1b1b1b', 'none', '#fbfbfd', '#d6d9e5', '#ffffff', '#e4e7f0', '#b3b9cc', '#cbcfdc', '#1b1b1b',
      '#e9ebf2', '#c7cbd9', '#9aa0b6', '#e2e5ee', '#b9bed0', '#6b7190', '#c6cad9', '#9ea4bb', '#fff', '#fff', '#000', '#eef0f5', '#c9cdda', '#3b3f52',
      '#8a90a8', '#c9cdda', '#a7adc2', '#8a90a8', '#fff', '#a9afc4']
  };
  // System: the Mac's own greys, light or dark, with the accent color on the
  // active button, the Start menu header and selected items.
  function xpSystem(accent, dark) {
    const actA = mix(accent, '#ffffff', 0.25), headA = mix(accent, '#ffffff', 0.2), headB = mix(accent, '#000000', 0.15);
    return dark
      ? ['#5c5c60', '#3b3b3e', '#2e2e31', '#1b1b1d', '#000000', '#fff', '0 1px 1px rgba(0, 0, 0, .5)', '#4c4c50', '#333336', '#5a5a5e', '#3e3e42', actA, accent, '#fff',
        '#3e3e41', '#29292c', '#111111', '#5a5a5e', '#3a3a3d', accent, headA, headB, '#fff', '#1f1f21', '#fff', '#2c2c2e', '#3e3e42', '#fff',
        accent, '#3b3b3e', '#252527', '#111111', '#fff', '#555555']
      : ['#ffffff', '#f2f2f4', '#e3e3e7', '#c8c8ce', '#a2a2aa', '#1d1d1f', 'none', '#ffffff', '#e2e2e7', '#ffffff', '#ececf0', actA, accent, '#fff',
        '#f6f6f8', '#dddde2', '#b4b4bc', '#ffffff', '#dcdce2', accent, headA, headB, '#fff', '#fff', '#000', '#f2f2f5', '#dcdce2', mix(accent, '#000000', 0.4),
        accent, '#ececf0', '#d4d4da', '#b4b4bc', '#1d1d1f', '#b4b4bc'];
  }
  function xpVars(c, look) {
    const list = c.scheme === 'system' ? xpSystem(look.accent, look.appearance === 'dark') : XP[c.scheme] || XP.blue;
    const out = {};
    XP_KEYS.forEach((k, i) => { out['--xp-' + k] = list[i]; });
    return out;
  }

  // MARK: Classic 1995

  // [name, bar and buttons, selected items, title from, title to]
  const W95 = {
    standard: ['Standard', '#c0c0c0', '#000080', '#000080', '#1084d0'],
    brick: ['Brick', '#c2bfa5', '#800000', '#800000', '#c08060'],
    desert: ['Desert', '#d5ccbb', '#008080', '#008080', '#80c0b8'],
    eggplant: ['Eggplant', '#90b0a8', '#5a4a7a', '#5a4a7a', '#9a88c0'],
    lilac: ['Lilac', '#b0a8d0', '#5a4e8c', '#5a4e8c', '#a094d0'],
    maple: ['Maple', '#d8c098', '#804000', '#804000', '#c08040'],
    marine: ['Marine', '#88c0b8', '#004060', '#004060', '#4080a0'],
    plum: ['Plum', '#a89890', '#483048', '#483048', '#987088'],
    pumpkin: ['Pumpkin', '#e0c070', '#804000', '#604020', '#d08040'],
    rainy: ['Rainy Day', '#8098b0', '#405068', '#405068', '#8098b8'],
    rose: ['Rose', '#d0a0a0', '#803040', '#803040', '#c07080'],
    slate: ['Slate', '#98a8b8', '#304860', '#304860', '#7090b0'],
    spruce: ['Spruce', '#a0c0a0', '#305030', '#305030', '#70a070'],
    storm: ['Storm', '#a0a0a0', '#404050', '#202030', '#606080'],
    teal: ['Teal', '#a8c8c0', '#006060', '#006060', '#40a0a0'],
    wheat: ['Wheat', '#d8d0a0', '#808000', '#808000', '#c0c060'],
    contrast: ['High Contrast', '#000000', '#800080', '#800080', '#800080']
  };
  // The four colors a Classic 1995 scheme stands for, System and Custom included.
  function w95Colors(c, look) {
    if (c.scheme === 'custom') return [c.face, c.selected, c.title1, c.title2];
    if (c.scheme === 'system') {
      const a = look.accent;
      return [look.appearance === 'dark' ? '#3a3a3c' : '#e8e8ea', a, a, a];
    }
    return (W95[c.scheme] || W95.standard).slice(1);
  }
  // The bevels, text and fields are worked out from the four colors.
  function w95Vars(c, look) {
    const [face, sel, title1, title2] = w95Colors(c, look);
    const dark = luminance(face) < 0.45;
    const text = dark ? '#ffffff' : '#000000';
    return {
      '--face': face,
      '--navy': sel,
      '--sel-text': luminance(sel) < 0.6 ? '#ffffff' : '#000000',
      '--title1': title1,
      '--title2': title2,
      '--title-text': luminance(title1) < 0.6 ? '#ffffff' : '#000000',
      '--hi': dark ? mix(face, '#ffffff', 0.6) : '#ffffff',
      '--lt': mix(face, '#ffffff', 0.5),
      '--sh': mix(face, '#000000', 0.33),
      '--dk': mix(face, '#000000', 0.95),
      '--text95': text,
      '--muted95': mix(text, face, 0.35),
      '--field': dark ? '#000000' : '#ffffff',
      '--field-text': dark ? '#ffffff' : '#000000'
    };
  }

  // MARK: Classic 2009

  // [name, color]. System takes the accent color.
  const GLASS = {
    system: ['System', null], sky: ['Sky', '#4a9ff5'], dusk: ['Dusk', '#2c4f8a'], sea: ['Sea', '#14a4a8'], leaf: ['Leaf', '#4ca54d'],
    lime: ['Lime', '#a3d55b'], sun: ['Sun', '#f2c94c'], pumpkin: ['Pumpkin', '#f39c32'], ruby: ['Ruby', '#c8343b'], pink: ['Pink', '#e055a5'],
    blush: ['Blush', '#f4a6c6'], violet: ['Violet', '#8b5bc0'], lavender: ['Lavender', '#b8a1e0'], taupe: ['Taupe', '#a69580'],
    cocoa: ['Cocoa', '#6b4a2f'], slate: ['Slate', '#6f7680'], frost: ['Frost', '#e8eef5'], graphite: ['Graphite', '#8e8e93']
  };
  function glassColor(c, look) {
    if (c.scheme === 'custom') return c.tint;
    const g = GLASS[c.scheme];
    return g && g[1] ? g[1] : look.accent;
  }
  function glassVars(c, look) {
    return { '--tint': glassColor(c, look), '--strength': (Number(c.intensity) || 34) + '%' };
  }

  // The variables for the current theme, as { '--name': value }.
  function schemeVars(settings, look) {
    const c = settings.colors || {};
    if (settings.theme === 'classic-2001') return xpVars(c, look);
    if (settings.theme === 'classic-1995') return w95Vars(c, look);
    if (settings.theme === 'classic-2009') return glassVars(c, look);
    return {};
  }

  window.schemeVars = schemeVars;
  window.schemes = { XP: Object.keys(XP), W95, GLASS, w95Colors, glassColor, mix };
})();
