// The settings window. Every page is drawn from PAGES, which also drives the
// search box. Each control writes straight to the settings, so the real bar
// and the preview change as you go.
(function () {
  const api = window.startbar;
  const el = (id) => document.getElementById(id);
  const navEl = el('nav'), titleEl = el('title'), pagesEl = el('pages'), contentEl = el('content');
  const queryEl = el('q'), previewEl = el('preview'), pv = el('pv');

  let state = null;
  let tasks = { accessibility: null };
  let page = 'appearance';
  let syncs = []; // functions that refresh the drawn controls from the settings
  const previewIcons = {};
  let trayStatus = null; // volume, Wi-Fi and battery, for the preview's tray

  const ICONS = {
    appearance: '<circle cx="8" cy="8" r="6"/><path d="M8 2v12M2 8h12"/>',
    taskbar: '<rect x="2" y="10" width="12" height="4" rx="1"/><rect x="4" y="3" width="8" height="5" rx="1"/>',
    startmenu: '<rect x="2" y="2" width="12" height="12" rx="2"/><path d="M5 6h6M5 9h4"/>',
    clock: '<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/>',
    displays: '<rect x="2" y="3" width="12" height="8" rx="1.5"/><path d="M6 13.5h4"/>',
    general: '<circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>',
    permissions: '<path d="M8 1.8l5 2v4c0 3.2-2.2 5.3-5 6.4-2.8-1.1-5-3.2-5-6.4v-4z"/><path d="M5.8 8l1.6 1.6 2.9-3"/>',
    about: '<circle cx="8" cy="8" r="6"/><path d="M8 7v4M8 5v.5"/>'
  };

  const SYSTEM_ONLY = { when: (s) => s.theme !== 'system', note: 'Not used by the classic themes.' };
  const GLASS = { when: (s) => s.theme !== 'system' && s.theme !== 'classic-2009', note: 'Not used by Classic 2001 and Classic 1995.' };
  // The accent color shows in the System theme, and in a classic theme set
  // to its System color scheme.
  const ACCENT = {
    when: (s) => s.theme !== 'system' && s.colors.scheme !== 'system',
    note: "Used by this theme's System color scheme."
  };

  const PAGES = [
    {
      id: 'appearance', title: 'Appearance', color: '#5e5ce6',
      groups: [
        {
          title: 'Look',
          rows: [
            { label: 'Theme', note: "System uses your Mac's colors. Classic 2009, Classic 2001 and Classic 1995 are retro looks. Each theme keeps its own look and size settings.",
              control: { type: 'select', key: 'theme', options: [['system', 'System'], ['classic-2009', 'Classic 2009'], ['classic-2001', 'Classic 2001'], ['classic-1995', 'Classic 1995']] } },
            { label: 'Appearance', systemOnly: true,
              control: { type: 'seg', key: 'appearance', options: [['auto', 'Follow Mac'], ['light', 'Light'], ['dark', 'Dark']] } },
            { label: 'Color scheme', note: 'The three color schemes this look came with, or System for your accent color and light or dark.',
              showWhen: (s) => s.theme === 'classic-2001',
              control: { type: 'select', key: 'colors.scheme', options: [['system', 'System'], ['blue', 'Blue'], ['olive', 'Olive Green'], ['silver', 'Silver']] } },
            { label: 'Color scheme', note: 'Pick one, System for your accent color and light or dark, or change a color below for your own.',
              showWhen: (s) => s.theme === 'classic-1995',
              control: { type: 'select', key: 'colors.scheme', options: [['system', 'System'], ...Object.entries(window.schemes.W95).map(([id, s]) => [id, s[0]]), ['custom', 'Custom']] } },
            { label: 'Glass color', note: 'System follows your accent color.', showWhen: (s) => s.theme === 'classic-2009', control: { type: 'glass' } },
            { label: 'Color intensity', showWhen: (s) => s.theme === 'classic-2009', control: { type: 'range', key: 'colors.intensity', min: 10, max: 80, step: 1, unit: '%' } },
            { label: 'Color mixer', showWhen: (s) => s.theme === 'classic-2009', control: { type: 'mixerLink' } },
            { label: 'Hue', showWhen: (s) => s.theme === 'classic-2009' && mixerOpen, control: { type: 'mixer', part: 0, max: 360, unit: '°' } },
            { label: 'Saturation', showWhen: (s) => s.theme === 'classic-2009' && mixerOpen, control: { type: 'mixer', part: 1, max: 100, unit: '%' } },
            { label: 'Brightness', showWhen: (s) => s.theme === 'classic-2009' && mixerOpen, control: { type: 'mixer', part: 2, max: 100, unit: '%' } },
            { label: 'Bar and buttons', showWhen: (s) => s.theme === 'classic-1995', control: { type: 'colors95', keys: ['face'] } },
            { label: 'Selected items', note: 'The highlight in the Start menu and lists.', showWhen: (s) => s.theme === 'classic-1995', control: { type: 'colors95', keys: ['selected'] } },
            { label: 'Title bars', note: 'A fade from the first color to the second.', showWhen: (s) => s.theme === 'classic-1995', control: { type: 'colors95', keys: ['title1', 'title2'] } },
            { label: 'Accent color', note: 'Follows the accent set in System Settings, or pick one here.', unused: ACCENT,
              control: { type: 'swatches', key: 'accent' } },
            { label: 'Translucent bar', note: 'Blurs whatever is behind the bar, like the menu bar.', unused: GLASS,
              control: { type: 'toggle', key: 'translucent' } }
          ]
        },
        {
          title: 'Size',
          rows: [
            { label: 'Bar height', control: { type: 'range', key: 'barHeight', min: 28, max: 56, step: 1 } },
            { label: 'Window buttons',
              control: { type: 'seg', key: 'labels', options: [['icon-and-title', 'Icon and title'], ['icons-only', 'Icons only']] } },
            { label: 'Widest a button can get', control: { type: 'range', key: 'maxButtonWidth', min: 100, max: 260, step: 10 } }
          ]
        },
        {
          title: 'Reset',
          rows: [
            { label: "Reset this theme's settings", note: 'Puts the look and size for the current theme back to its defaults. The other themes keep theirs.',
              control: { type: 'button', text: 'Reset…', click: () => api.resetThemeSettings() } }
          ]
        }
      ]
    },
    {
      id: 'taskbar', title: 'Taskbar', color: '#0a84ff',
      groups: [
        {
          title: 'Start button and pins',
          rows: [
            { label: 'Show the word Start on the button', unused: { when: (s) => s.theme === 'classic-2009', note: 'Classic 2009 has a round button with no word on it.' },
              control: { type: 'toggle', key: 'taskbar.showStartLabel' } },
            { label: 'Show pinned apps on the bar', control: { type: 'toggle', key: 'taskbar.showPins' } },
            { label: 'Where pinned apps go', note: "In the row, a pinned app's button turns into its window buttons once it opens.",
              onlyWith: { when: (s) => s.taskbar.showPins, note: 'Used when pinned apps are shown.' },
              control: { type: 'seg', key: 'taskbar.pinsPlace', options: [['own', 'Their own spot'], ['row', 'In the row with windows']] } }
          ]
        },
        {
          title: 'Pinned apps',
          rows: [
            { list: 'pins', label: 'Pinned apps' },
            { label: 'Pin an app', note: 'Drag the list to reorder. You can also right click an app in the Start menu or on the bar and pick Pin to Bar.',
              control: { type: 'button', text: 'Add…', click: () => api.addPins() } }
          ]
        },
        {
          title: 'Window buttons',
          rows: [
            { label: 'Group windows from the same app',
              control: { type: 'select', key: 'taskbar.grouping', options: [['always', 'Always'], ['full', 'When the bar is full'], ['never', 'Never']] } },
            { label: "Clicking the active window's button minimizes it", control: { type: 'toggle', key: 'taskbar.clickActiveMinimizes' } },
            { label: 'Show the window title when hovering a button', control: { type: 'toggle', key: 'taskbar.titleOnHover' } },
            { label: 'Show apps that are running but have no windows', control: { type: 'toggle', key: 'taskbar.showWindowless' } },
            { label: 'Order', note: 'New windows go on the right in either case.',
              control: { type: 'select', key: 'taskbar.order', options: [['opened', 'In the order they opened'], ['app', 'Grouped by app']] } }
          ]
        },
        {
          title: 'Bar behavior',
          rows: [
            { label: 'Show Desktop strip at the right end', note: 'Click it to hide every app, and again to bring them back.',
              control: { type: 'toggle', key: 'taskbar.showDesktop' } },
            { label: 'Hide the bar when an app is full screen', control: { type: 'toggle', key: 'taskbar.hideInFullScreen' } },
            { label: 'Hide the bar until the mouse reaches the bottom edge', note: 'The bar also comes up while the Start menu is open.',
              control: { type: 'toggle', key: 'taskbar.autoHide' } },
            { label: 'Move windows up when they would cover the bar', note: "macOS can't reserve space for the bar, so Startbar nudges windows instead.",
              unused: { when: (s) => s.taskbar.autoHide, note: 'Not used while the bar hides itself.' },
              control: { type: 'toggle', key: 'taskbar.moveWindowsUp' } },
            { label: 'The Dock', note: 'The Dock and the bar share the bottom edge. Hiding the Dock is the usual setup.',
              control: { type: 'dock' },
              hint: { when: (s) => s.dock && s.dock.position !== 'bottom', text: 'Minimized windows shrink toward the Dock, so with the Dock on the side they go off to that side.' } },
            { label: 'Show Startbar in the menu bar', note: 'The menu bar icon brings a hidden bar back.',
              control: { type: 'select', key: 'menuBarIcon', options: [['hidden', 'Only while the bar is hidden'], ['always', 'Always']] } }
          ]
        }
      ]
    },
    {
      id: 'startmenu', title: 'Start Menu', color: '#30d158',
      groups: [
        {
          title: 'Left column',
          rows: [
            { label: 'Show recently used apps', note: 'Listed under Recent, above All Applications.', control: { type: 'toggle', key: 'startMenu.showRecent' } },
            { label: 'How many', onlyWith: { when: (s) => s.startMenu.showRecent, note: 'Used when recent apps are shown.' },
              control: { type: 'stepper', key: 'startMenu.recentCount', min: 1, max: 5 } },
            { label: 'Put the cursor in the search box when the menu opens', control: { type: 'toggle', key: 'startMenu.focusSearch' } },
            { label: 'Search also finds', note: 'Apps are always included. Files come from Spotlight.',
              control: { type: 'select', key: 'startMenu.search', options: [['apps', 'Apps only'], ['files', 'Apps and files in your home folder']] } }
          ]
        },
        {
          title: 'Right column',
          rows: [
            { label: 'Applications', control: { type: 'toggle', key: 'startMenu.rightColumn.applications' } },
            { label: 'Documents', control: { type: 'toggle', key: 'startMenu.rightColumn.documents' } },
            { label: 'Downloads', control: { type: 'toggle', key: 'startMenu.rightColumn.downloads' } },
            { label: 'Home folder', control: { type: 'toggle', key: 'startMenu.rightColumn.home' } },
            { label: 'System Settings', control: { type: 'toggle', key: 'startMenu.rightColumn.systemSettings' } },
            { list: 'folders', label: 'Added folders' },
            { label: 'Add a folder', note: 'Any folder can get its own entry, under Home. Drag the added ones to reorder.',
              control: { type: 'button', text: 'Choose…', click: () => api.addFolders() } }
          ]
        },
        {
          title: 'Footer',
          rows: [
            { label: 'Show Sleep, Log Out and Shut Down', control: { type: 'toggle', key: 'startMenu.showPower' } },
            { label: 'Ask before shutting down or logging out', control: { type: 'toggle', key: 'startMenu.confirmPower' } }
          ]
        },
        {
          title: 'Keyboard',
          rows: [
            { label: 'Open the Start menu', note: 'Click the field and press the keys you want. Delete clears it.',
              control: { type: 'shortcut', key: 'startMenu.shortcut' } }
          ]
        }
      ]
    },
    {
      id: 'clock', title: 'Clock and Tray', color: '#ff9f0a',
      groups: [
        {
          title: 'Clock',
          rows: [
            { label: 'Time format', control: { type: 'seg', key: 'clock.hour12', options: [[true, '12-hour'], [false, '24-hour']] } },
            { label: 'Show seconds', control: { type: 'toggle', key: 'clock.seconds' } },
            { label: 'Show the date under the time', control: { type: 'toggle', key: 'clock.showDate' } },
            { label: 'Date style',
              control: { type: 'select', key: 'clock.dateStyle', options: ['short', 'weekday', 'numeric', 'dayFirst'].map((v) => [v, window.dateText(new Date(), v)]) } },
            { label: 'Clicking the clock opens', note: 'Hovering always shows the full date.',
              control: { type: 'select', key: 'clock.click', options: [['calendar', 'A small calendar'], ['app', 'The Calendar app'], ['nothing', 'Nothing']] } }
          ]
        },
        {
          title: 'Tray',
          rows: [
            { label: 'Volume', control: { type: 'toggle', key: 'tray.volume' } },
            { label: 'Wi-Fi', note: 'Shown when the Mac has Wi-Fi.', control: { type: 'toggle', key: 'tray.wifi' },
              hint: { when: (s) => s.permissions.location !== 'allowed', text: 'To see the network name, allow Location on the ', link: 'Permissions page', after: '.',
                click: () => openPage('permissions') } },
            { label: 'Battery', note: 'Shown on laptops only.', control: { type: 'toggle', key: 'tray.battery' } },
            { label: 'Bluetooth', note: 'Your devices, their battery and an on and off switch. Shown when the Mac has Bluetooth.',
              control: { type: 'toggle', key: 'tray.bluetooth' },
              hint: { when: (s) => s.permissions.bluetooth !== 'allowed', text: 'Needs the Bluetooth permission on the ', link: 'Permissions page', after: '.',
                click: () => openPage('permissions') } },
            { label: 'Show the collapse arrow', note: 'Hides the tray icons behind one click, like the original.',
              control: { type: 'toggle', key: 'tray.collapseArrow' } }
          ]
        }
      ],
      note: "Other apps' menu bar icons can't be moved into the tray. macOS doesn't allow it. They stay in the menu bar at the top."
    },
    {
      id: 'displays', title: 'Displays', color: '#64d2ff',
      groups: [
        {
          title: 'Which screens',
          rows: [
            { label: 'Show the bar on',
              control: { type: 'seg', key: 'displays.bars', options: [['all', 'All displays'], ['main', 'Main display only']] } },
            { label: 'On each display, show buttons for', onlyWith: { when: (s) => s.displays.bars === 'all', note: 'Used when there is a bar on every display.' },
              control: { type: 'select', key: 'displays.buttons', options: [['display', 'Windows on that display'], ['all', 'All windows']] } },
            { label: 'Show the clock and tray on', onlyWith: { when: (s) => s.displays.bars === 'all', note: 'Used when there is a bar on every display.' },
              control: { type: 'seg', key: 'displays.tray', options: [['every', 'Every bar'], ['main', 'Main display only']] } }
          ]
        },
        {
          title: 'Spaces',
          rows: [
            { label: 'Show windows from', note: 'Windows from other Spaces switch to that Space when clicked.',
              control: { type: 'seg', key: 'spaces.show', options: [['current', 'The current Space'], ['all', 'All Spaces']] } }
          ]
        }
      ]
    },
    {
      id: 'general', title: 'General', color: '#8e8e93',
      groups: [
        {
          title: 'Startup',
          rows: [
            { label: 'Open Startbar at login', control: { type: 'login' } },
            { label: 'Check for updates automatically', note: 'Startbar only checks, it never installs anything on its own.',
              control: { type: 'toggle', key: 'updates.auto' } }
          ]
        },
        {
          title: 'Settings',
          rows: [
            { label: 'Export settings and pins to a file', note: 'Import replaces everything here with what the file has.',
              control: { type: 'buttons', list: [{ text: 'Export…', click: () => api.exportSettings() }, { text: 'Import…', click: () => api.importSettings() }] } },
            { label: 'Reset everything to the defaults', control: { type: 'button', text: 'Reset…', click: () => api.resetSettings() } }
          ]
        }
      ]
    },
    {
      id: 'permissions', title: 'Permissions', color: '#30b0c7', preview: false,
      groups: [
        {
          title: 'What Startbar can use',
          rows: [
            { label: 'Accessibility', note: 'Window titles on the bar, and bringing a window forward when you click its button. Without it the bar shows app icons only.',
              control: { type: 'permission', name: 'accessibility' } },
            { label: 'Automation (System Events)', note: 'The Dock buttons on the Taskbar page.',
              control: { type: 'permission', name: 'automation' } },
            { label: 'Location', note: "The Wi-Fi network's name in the tray. macOS counts the network name as location, so it asks. Startbar doesn't read where you are.",
              control: { type: 'permission', name: 'location' } },
            { label: 'Bluetooth', note: 'A Bluetooth icon in the tray with your devices, their battery and an on and off switch.',
              control: { type: 'permission', name: 'bluetooth' } }
          ]
        }
      ],
      note: 'Accessibility is asked once, when Startbar first opens. The others are asked only when you press their button here, or the button they belong to. You can change any of them later in System Settings, Privacy and Security.'
    },
    { id: 'about', title: 'About', color: '#ff375f', about: true, groups: [] }
  ];

  // MARK: settings access

  function getPath(path) {
    return path.split('.').reduce((o, k) => (o == null ? o : o[k]), state.settings);
  }

  function setPath(path, value) {
    const keys = path.split('.');
    const patch = {};
    let o = patch;
    keys.slice(0, -1).forEach((k) => { o = o[k] = {}; });
    o[keys[keys.length - 1]] = value;
    api.updateSettings(patch);
  }

  // MARK: controls

  function node(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function toggle(c) {
    const t = node('div', 'toggle');
    t.addEventListener('click', () => setPath(c.key, !getPath(c.key)));
    syncs.push(() => t.classList.toggle('on', !!getPath(c.key)));
    return t;
  }

  function seg(c) {
    const s = node('div', 'seg');
    const parts = c.options.map(([v, text]) => {
      const p = node('span', null, text);
      p.addEventListener('click', () => setPath(c.key, v));
      s.append(p);
      return [v, p];
    });
    syncs.push(() => parts.forEach(([v, p]) => p.classList.toggle('on', getPath(c.key) === v)));
    return s;
  }

  function select(c) {
    const s = node('select');
    for (const [v, text] of c.options) {
      const o = node('option', null, text);
      o.value = v;
      s.append(o);
    }
    s.addEventListener('change', () => setPath(c.key, s.value));
    syncs.push(() => { s.value = getPath(c.key); });
    return s;
  }

  // Color pickers for Classic 1995. They show the colors of the scheme in
  // use, and changing one makes a Custom scheme from those colors.
  const W95_KEYS = ['face', 'selected', 'title1', 'title2'];
  const w95Now = () => {
    const list = window.schemes.w95Colors(state.settings.colors, window.resolveTheme(state));
    return Object.fromEntries(W95_KEYS.map((k, i) => [k, list[i]]));
  };
  let colorWrite = null; // the picker sends many changes a second, so writes wait a moment
  function colors95(c) {
    const box = node('div', 'colors');
    const inputs = c.keys.map((k) => {
      const input = node('input');
      input.type = 'color';
      input.addEventListener('input', () => {
        const next = { ...w95Now(), [k]: input.value };
        clearTimeout(colorWrite);
        colorWrite = setTimeout(() => api.updateSettings({ colors: { scheme: 'custom', ...next } }), 60);
      });
      box.append(input);
      return [k, input];
    });
    syncs.push(() => {
      const now = w95Now();
      inputs.forEach(([k, input]) => { if (document.activeElement !== input) input.value = now[k]; });
    });
    return box;
  }

  // Classic 2009's glass color: System first, then its colors. The mixer
  // under it picks any color, which makes it Custom.
  let mixerOpen = false;
  const glassNow = () => window.schemes.glassColor(state.settings.colors, window.resolveTheme(state));
  function glass() {
    const wrap = node('div', 'glass');
    const box = node('div', 'swatches square');
    const name = node('small', 'glass-name');
    const dots = Object.entries(window.schemes.GLASS).map(([id, [label, color]]) => {
      const d = node('i', color ? null : 'auto');
      if (color) d.style.background = color;
      d.title = label;
      d.addEventListener('click', () => setPath('colors.scheme', id));
      box.append(d);
      return [id, d];
    });
    wrap.append(box, name);
    syncs.push(() => {
      const scheme = state.settings.colors.scheme;
      dots.forEach(([id, d]) => d.classList.toggle('on', id === scheme));
      name.textContent = scheme === 'custom' ? 'Custom' : (window.schemes.GLASS[scheme] || ['Sky'])[0];
    });
    return wrap;
  }
  function mixerLink() {
    const l = node('span', 'link', 'Show color mixer');
    l.addEventListener('click', () => {
      mixerOpen = !mixerOpen;
      l.textContent = mixerOpen ? 'Hide color mixer' : 'Show color mixer';
      syncs.forEach((fn) => fn());
    });
    return l;
  }
  function mixer(c) {
    const box = node('div', 'ctl-inner');
    box.style.display = 'contents';
    const r = node('input');
    r.type = 'range';
    r.min = 0;
    r.max = c.max;
    const val = node('span', 'val');
    let frame = 0;
    r.addEventListener('input', () => {
      val.textContent = r.value + c.unit;
      const hsl = window.schemes.toHsl(glassNow());
      hsl[c.part] = Number(r.value);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => api.updateSettings({ colors: { scheme: 'custom', tint: window.schemes.fromHsl(hsl) } }));
    });
    syncs.push(() => {
      const v = window.schemes.toHsl(glassNow())[c.part];
      if (document.activeElement !== r) r.value = v;
      val.textContent = Math.round(document.activeElement === r ? r.value : v) + c.unit;
    });
    box.append(r, val);
    return box;
  }

  function swatches(c) {
    const box = node('div', 'swatches');
    const names = { auto: 'Follow Mac', blue: 'Blue', purple: 'Purple', pink: 'Pink', red: 'Red', orange: 'Orange', yellow: 'Yellow', green: 'Green', graphite: 'Graphite' };
    const dots = Object.keys(names).map((v) => {
      const d = node('i', v === 'auto' ? 'auto' : null);
      d.title = names[v];
      d.addEventListener('click', () => setPath(c.key, v));
      box.append(d);
      return [v, d];
    });
    syncs.push(() => {
      const dark = window.resolveTheme(state).appearance === 'dark';
      dots.forEach(([v, d]) => {
        if (v !== 'auto') d.style.background = window.ACCENTS[v][dark ? 1 : 0];
        d.classList.toggle('on', getPath(c.key) === v);
      });
    });
    return box;
  }

  // Dragging writes as it goes, at most once a frame.
  function range(c) {
    const box = node('div', 'ctl-inner');
    box.style.display = 'contents';
    const r = node('input');
    r.type = 'range';
    r.min = c.min;
    r.max = c.max;
    r.step = c.step;
    const val = node('span', 'val');
    let frame = 0;
    r.addEventListener('input', () => {
      val.textContent = r.value + (c.unit || ' px');
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setPath(c.key, Number(r.value)));
    });
    syncs.push(() => {
      if (document.activeElement !== r) r.value = getPath(c.key);
      val.textContent = getPath(c.key) + (c.unit || ' px');
    });
    box.append(r, val);
    return box;
  }

  function stepper(c) {
    const s = node('div', 'stepper');
    const boxEl = node('span', 'box');
    const arrows = node('span', 'arrows');
    const up = node('i', null, '▲');
    const down = node('i', null, '▼');
    const step = (d) => setPath(c.key, Math.max(c.min, Math.min(c.max, getPath(c.key) + d)));
    up.addEventListener('click', () => step(1));
    down.addEventListener('click', () => step(-1));
    arrows.append(up, down);
    s.append(boxEl, arrows);
    syncs.push(() => { boxEl.textContent = getPath(c.key); });
    return s;
  }

  function button(c) {
    const b = node('span', 'btn', c.text);
    b.addEventListener('click', c.click);
    return b;
  }

  function buttons(c) {
    const box = node('div', 'ctl-inner');
    box.style.display = 'contents';
    box.append(...c.list.map(button));
    return box;
  }

  // The login item as macOS has it. A new login item can wait for the
  // person to allow it in System Settings, which the row says.
  function login(c, rowEl) {
    const t = node('div', 'toggle');
    t.addEventListener('click', () => api.setLoginItem(!state.loginItem.on));
    const warn = node('small', 'warn hidden', 'macOS is waiting for you to allow Startbar in System Settings, General, Login Items.');
    rowEl.querySelector('.lbl').append(warn);
    syncs.push(() => {
      t.classList.toggle('on', !!state.loginItem.on);
      warn.classList.toggle('hidden', !state.loginItem.needsApproval);
    });
    return t;
  }

  // Where a permission stands, with the button that asks for it, or opens
  // System Settings once it's been turned down.
  const STANDING = {
    allowed: ['', 'Allowed'],
    notAsked: ['wait', 'Not asked yet'],
    denied: ['bad', 'Turned off'],
    off: ['warn', 'Location Services is off']
  };

  function permission(c) {
    const box = node('div', 'ctl-inner');
    box.style.display = 'contents';
    const status = node('span', 'status');
    const dot = node('i');
    const text = node('span');
    status.append(dot, text);
    const b = button({ text: '', click: () => api.askPermission(c.name) });
    syncs.push(() => {
      // Accessibility can't be asked for, only switched on in System Settings.
      const acc = tasks.accessibility;
      const now = c.name === 'accessibility' ? (acc ? 'allowed' : acc === false ? 'denied' : null) : state.permissions[c.name];
      const [cls, label] = STANDING[now] || ['wait', 'Checking'];
      dot.className = cls;
      text.textContent = label;
      b.textContent = now === 'notAsked' ? 'Allow…' : 'Open System Settings…';
      b.classList.toggle('hidden', !now || now === 'allowed');
    });
    box.append(status, b);
    return box;
  }

  // Whether the Dock hides itself, with a button to change it. A Dock on
  // the left or right doesn't share the bottom edge, but minimized windows
  // fly off toward it, so the button offers to move it down.
  function dock(c, rowEl) {
    const note = rowEl.querySelector('.lbl small'); // about sharing the bottom edge
    const box = node('div', 'ctl-inner');
    box.style.display = 'contents';
    const status = node('span', 'status');
    const dot = node('i');
    const text = node('span');
    status.append(dot, text);
    const b = button({
      text: '',
      click: () => {
        const d = state.dock;
        if (d && d.position !== 'bottom') api.moveDockToBottom();
        else if (d) api.setDockHidden(!d.autohide);
      }
    });
    syncs.push(() => {
      const d = state.dock;
      const side = d && d.position !== 'bottom';
      dot.className = !d ? 'wait' : side || d.autohide ? '' : 'warn';
      text.textContent = !d ? 'Checking' : side ? `The Dock is on the ${d.position}` : d.autohide ? 'The Dock hides itself' : 'The Dock is visible';
      b.textContent = side ? 'Move to the Bottom' : d && d.autohide ? 'Show the Dock' : 'Hide the Dock';
      b.classList.toggle('hidden', !d);
      note.classList.toggle('hidden', side);
    });
    box.append(status, b);
    return box;
  }

  // Keyboard shortcut field. Records the next key with at least one
  // modifier (function keys work alone) as an Electron accelerator.
  const SYMBOLS = { Control: '⌃', Alt: '⌥', Shift: '⇧', Command: '⌘' };
  const NAMED = {
    Space: 'Space', Enter: 'Return', Tab: 'Tab', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';',
    Quote: "'", Comma: ',', Period: '.', Slash: '/', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown'
  };

  function keyName(code) {
    let m = /^Key([A-Z])$/.exec(code);
    if (m) return m[1];
    m = /^Digit(\d)$/.exec(code);
    if (m) return m[1];
    if (/^F\d{1,2}$/.test(code)) return code;
    return NAMED[code] || null;
  }

  function mods(e) {
    return [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Command'].filter(Boolean);
  }

  function pretty(accel) {
    if (!accel) return 'None';
    return accel.split('+').map((p) => SYMBOLS[p] || p).join(' ');
  }

  function shortcut(c, rowEl) {
    const k = node('div', 'kbd');
    k.tabIndex = 0;
    let recording = false;
    const warn = node('small', 'warn hidden');
    rowEl.querySelector('.lbl').append(warn);

    function stop() {
      if (!recording) return;
      recording = false;
      k.classList.remove('rec');
      api.resumeShortcut();
      syncs.forEach((fn) => fn());
    }
    k.addEventListener('click', () => {
      if (recording) return;
      recording = true;
      k.classList.add('rec');
      k.textContent = 'Press keys';
      api.pauseShortcut();
    });
    k.addEventListener('blur', stop);
    k.addEventListener('keydown', (e) => {
      if (!recording) return;
      e.preventDefault();
      if (e.code === 'Escape') return stop();
      const held = mods(e);
      if ((e.code === 'Backspace' || e.code === 'Delete') && held.length === 0) {
        setPath(c.key, '');
        return stop();
      }
      const key = keyName(e.code);
      if (!key) {
        k.textContent = held.length ? held.map((m) => SYMBOLS[m]).join(' ') : 'Press keys';
        return;
      }
      if (held.length === 0 && !/^F\d/.test(key)) return;
      setPath(c.key, [...held, key].join('+'));
      stop();
    });
    syncs.push(() => {
      if (!recording) k.textContent = pretty(getPath(c.key));
      const err = state.shortcutError;
      warn.textContent = err === 'taken' ? 'Another app is using this shortcut. Pick another one.'
        : err === 'invalid' ? "macOS doesn't accept this shortcut. Pick another one." : '';
      warn.classList.toggle('hidden', !err);
    });
    return k;
  }

  const CONTROLS = { toggle, seg, select, swatches, colors95, glass, mixerLink, mixer, range, stepper, button, buttons, login, permission, dock, shortcut };

  // Lists of paths drawn inside a group, one row each, drag to reorder:
  // the pinned apps and the folders added to the Start menu.
  const home = () => state.home;
  const LISTS = {
    pins: {
      get: () => state.pins,
      name: (p) => p.split('/').pop().replace(/\.app$/, ''),
      set: (list) => api.setPins(list),
      remove: (p) => api.unpin(p),
      empty: 'No pinned apps.'
    },
    folders: {
      get: () => state.settings.startMenu.folders,
      name: (p) => p.split('/').pop() || p,
      where: (p) => (p.startsWith(home() + '/') ? '~' + p.slice(home().length) : p),
      set: (list) => api.setFolders(list),
      remove: (p) => api.setFolders(state.settings.startMenu.folders.filter((x) => x !== p)),
      empty: 'No added folders.'
    }
  };
  const listKey = (paths) => JSON.stringify(paths.map((p) => [p, !!previewIcons[p]]));

  function listRow(spec, p) {
    const r = node('div', 'row');
    r.dataset.key = p;
    const grip = node('span', 'handle');
    grip.innerHTML = '<svg viewBox="0 0 8 12"><circle cx="2" cy="2" r="1"/><circle cx="6" cy="2" r="1"/><circle cx="2" cy="6" r="1"/><circle cx="6" cy="6" r="1"/><circle cx="2" cy="10" r="1"/><circle cx="6" cy="10" r="1"/></svg>';
    const img = node('img');
    img.alt = '';
    if (previewIcons[p]) img.src = previewIcons[p];
    const lbl = node('div', 'lbl', spec.name(p));
    if (spec.where) lbl.append(node('small', null, spec.where(p)));
    const remove = button({ text: 'Remove', click: () => spec.remove(p) });
    remove.classList.add('no-drag');
    r.append(grip, img, lbl, remove);
    return r;
  }

  function pathList(name) {
    const spec = LISTS[name];
    const list = node('div', 'paths');
    let drawn = '';
    window.reorderable(list, {
      axis: 'y',
      onDrop: (order) => {
        drawn = listKey(order);
        spec.set(order);
      }
    });
    syncs.push(() => {
      const paths = spec.get();
      fetchIcons(paths);
      const key = listKey(paths);
      if (key === drawn) return;
      drawn = key;
      list.replaceChildren(...(paths.length ? paths.map((p) => listRow(spec, p)) : [node('div', 'row none', spec.empty)]));
    });
    return list;
  }

  // MARK: drawing

  function row(r) {
    const rowEl = node('div', 'row');
    const lbl = node('div', 'lbl', r.label);
    if (r.note) lbl.append(node('small', null, r.note));
    const ctl = node('div', 'ctl');
    rowEl.append(lbl, ctl);
    ctl.append(CONTROLS[r.control.type](r.control, rowEl));
    // A line that shows only in some states, sometimes ending in a link.
    if (r.hint) {
      const hint = node('small', 'hint hidden', r.hint.text);
      if (r.hint.link) {
        const link = node('span', 'link', r.hint.link);
        link.addEventListener('click', r.hint.click);
        hint.append(link, r.hint.after || '');
      }
      lbl.append(hint);
      syncs.push(() => hint.classList.toggle('hidden', !r.hint.when(state)));
    }
    if (r.showWhen) syncs.push(() => rowEl.classList.toggle('hidden', !r.showWhen(state.settings)));
    const unusedIf = r.systemOnly ? SYSTEM_ONLY
      : r.onlyWith ? { when: (s) => !r.onlyWith.when(s), note: r.onlyWith.note } : r.unused;
    if (unusedIf) {
      const note = node('small', 'unused-note hidden', unusedIf.note);
      lbl.append(note);
      syncs.push(() => {
        const unused = unusedIf.when(state.settings);
        rowEl.classList.toggle('unused', unused);
        note.classList.toggle('hidden', !unused);
      });
    }
    return rowEl;
  }

  function groups(list) {
    const out = [];
    for (const g of list) {
      if (g.rows.length === 0) continue;
      out.push(node('h2', null, g.title));
      const box = node('div', 'group');
      g.rows.forEach((r) => box.append(r.list ? pathList(r.list) : row(r)));
      out.push(box);
    }
    return out;
  }

  function aboutPage() {
    const box = node('div', 'about');
    const icon = node('div', 'icon');
    icon.innerHTML = '<svg viewBox="0 0 20 20"><rect x="2" y="3" width="16" height="14" rx="2" fill="#fff"/><rect x="4.5" y="9" width="11" height="1.6" rx=".8" fill="#1c2541"/><rect x="4.5" y="12.2" width="7" height="1.6" rx=".8" fill="#1c2541"/></svg>';
    const version = node('p');
    syncs.push(() => { version.textContent = 'Version ' + state.version; });
    const links = node('div', 'links');
    const kofi = button({ text: 'Support on Ko-fi', click: () => api.openLink('kofi') });
    kofi.classList.add('primary');
    links.append(kofi, button({ text: 'Report an Issue', click: () => api.openLink('issues') }), button({ text: 'Check for Updates', click: () => api.checkUpdates() }));
    const update = node('p', 'update');
    syncs.push(() => {
      const u = state.update || { state: 'idle' };
      update.textContent = {
        checking: 'Checking…',
        current: 'Startbar is up to date.',
        available: `Version ${u.latest} is available. Run the line below, then quit Startbar and open it again.`,
        failed: "Couldn't reach npm to check. Try again later."
      }[u.state] || '';
      update.classList.toggle('available', u.state === 'available');
    });
    const install = node('p', null, 'Install or update with ');
    install.append(node('code', null, 'npm install -g startbar'));
    box.append(icon, node('h1', null, 'Startbar'), version, node('p', null, 'A taskbar for macOS. Free to use. Prather Bytecraft.'), links, update, install);
    return box;
  }

  function drawNav() {
    navEl.replaceChildren(...PAGES.map((p) => {
      const a = node('a');
      a.href = '#' + p.id;
      a.dataset.page = p.id;
      const ic = node('span', 'ic');
      ic.style.background = p.color;
      ic.innerHTML = `<svg viewBox="0 0 16 16">${ICONS[p.id]}</svg>`;
      a.append(ic, document.createTextNode(p.title));
      a.addEventListener('click', (e) => {
        e.preventDefault();
        queryEl.value = '';
        show(p.id);
      });
      return a;
    }));
  }

  // Call before building the controls, which add their sync functions.
  function reset() {
    syncs = [];
  }

  function draw(children, title) {
    titleEl.textContent = title;
    pagesEl.replaceChildren(...children);
    if (state) syncs.forEach((fn) => fn());
  }

  function show(id) {
    page = id;
    const p = PAGES.find((x) => x.id === id);
    navEl.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a.dataset.page === id));
    previewEl.classList.toggle('hidden', !!p.about || p.preview === false);
    reset();
    const children = p.about ? [aboutPage()] : groups(p.groups);
    if (p.note) children.push(node('div', 'foot-note', p.note));
    draw(children, p.title);
    contentEl.scrollTop = 0;
  }

  // A page from a link or from the main process. Leaves search, like the sidebar does.
  function openPage(id) {
    if (!PAGES.some((p) => p.id === id)) return;
    queryEl.value = '';
    show(id);
  }

  // Search shows every matching row, under its page's name.
  function search(q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return show(page);
    navEl.querySelectorAll('a').forEach((a) => a.classList.remove('on'));
    previewEl.classList.remove('hidden');
    const text = (r) => [r.label, r.note, ...((r.control && r.control.options) || []).map((o) => o[1])].join(' ').toLowerCase();
    const matches = (r) => words.every((w) => text(r).includes(w));
    const found = PAGES.filter((p) => !p.about).map((p) => ({
      title: p.title,
      rows: p.groups.flatMap((g) => g.rows.filter(matches))
    }));
    reset();
    const children = groups(found);
    draw(children.length ? children : [node('div', 'empty', 'No settings match.')], 'Search');
  }

  queryEl.addEventListener('input', () => search(queryEl.value.trim()));
  queryEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      queryEl.value = '';
      search('');
    }
  });

  // MARK: preview and state

  function pushPreview() {
    if (!state || !pv.contentWindow) return;
    pv.contentWindow.postMessage({ state, icons: previewIcons, status: trayStatus }, '*');
  }

  // Icons for the sample apps and the pins, fetched once each.
  const askedIcons = new Set();
  function fetchIcons(paths) {
    const missing = paths.filter((p) => !askedIcons.has(p));
    if (missing.length === 0) return;
    missing.forEach((p) => askedIcons.add(p));
    api.taskIcons(missing).then((found) => {
      Object.assign(previewIcons, found);
      if (state) syncs.forEach((fn) => fn());
      pushPreview();
    });
  }

  function apply(next) {
    state = next;
    fetchIcons(state.pins);
    const theme = window.resolveTheme(state);
    const root = document.documentElement;
    root.dataset.appearance = theme.appearance;
    root.style.setProperty('--accent', theme.accent);
    root.style.setProperty('--accent-text', theme.accentText);
    syncs.forEach((fn) => fn());
    pushPreview();
  }

  const SAMPLE_APPS = [
    '/System/Library/CoreServices/Finder.app',
    '/Applications/Safari.app',
    '/System/Applications/Notes.app',
    '/System/Applications/Utilities/Terminal.app'
  ];
  fetchIcons(SAMPLE_APPS);

  pv.addEventListener('load', pushPreview);
  drawNav();
  // Opened on a page, for example About from the Start menu's update item.
  const asked = location.hash.slice(1);
  if (PAGES.some((p) => p.id === asked)) page = asked;
  show(page);
  api.onSettingsPage(openPage);
  api.getState().then(apply);
  api.onState(apply);
  // The task list comes in a few times a second. Only the permission row uses it.
  const applyTasks = (t) => {
    const changed = t.accessibility !== tasks.accessibility;
    tasks = t;
    if (changed && state) syncs.forEach((fn) => fn());
  };
  api.getTasks().then(applyTasks);
  const applyStatus = (s) => {
    trayStatus = s;
    pushPreview();
  };
  api.getStatus().then(applyStatus);
  api.onStatus(applyStatus);
  api.onTasks(applyTasks);
})();
