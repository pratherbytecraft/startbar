// Draws a sample bar from the settings the window sends: the real pins, a
// Finder group, an active Safari window, Notes and a minimized Terminal. It
// follows the theme, colors, size, labels, grouping and clock settings.
(function () {
  const tasksEl = document.getElementById('tasks');
  const quickEl = document.querySelector('.quick');
  const trayEl = document.getElementById('tray-icons');
  const chevEl = document.getElementById('chev');
  let status = null;
  const clock = document.getElementById('clock');
  const timeEl = document.getElementById('time');
  const dateEl = document.getElementById('date');
  let state = null;
  let icons = {};

  const SAMPLE = [
    { name: 'Finder', path: '/System/Library/CoreServices/Finder.app', windows: ['Downloads', 'Documents', 'Applications'] },
    { name: 'Safari', path: '/Applications/Safari.app', windows: ['Startbar'], active: true },
    { name: 'Notes', path: '/System/Applications/Notes.app', windows: ['Shopping list'] },
    { name: 'Terminal', path: '/System/Applications/Utilities/Terminal.app', windows: ['zsh'], dim: true }
  ];

  function button(app, title, count) {
    const b = document.createElement('div');
    b.className = 'task' + (app.active ? ' active' : '') + (app.dim ? ' dim' : '');
    const img = document.createElement('img');
    img.alt = '';
    if (icons[app.path]) img.src = icons[app.path];
    b.append(img);
    if (count) {
      const c = document.createElement('span');
      c.className = 'count';
      c.textContent = count;
      b.append(c);
    }
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = title;
    b.append(label);
    if (count) {
      const caret = document.createElement('span');
      caret.className = 'caret';
      b.append(caret);
    }
    return b;
  }

  // The preview bar is never full, so only "Always" groups.
  function render() {
    const pins = state.settings.taskbar.showPins ? state.pins : [];
    quickEl.replaceChildren(...pins.map((p) => {
      const d = document.createElement('div');
      d.className = 'icon';
      const img = document.createElement('img');
      img.alt = '';
      if (icons[p]) img.src = icons[p];
      d.append(img);
      return d;
    }));
    // The tray as the real bar has it, from the Mac's own reading.
    const t = state.settings.tray;
    const all = window.trayIcons.shown(state.settings, status);
    const collapsed = t.collapseArrow && t.collapsed;
    chevEl.classList.toggle('hidden', !t.collapseArrow || all.length === 0);
    chevEl.textContent = collapsed ? '‹' : '›';
    trayEl.replaceChildren(...(collapsed ? [] : all).map((kind) => {
      const s = document.createElement('span');
      s.className = 'tray-icon';
      s.innerHTML = window.trayIcons[kind](status[kind]);
      return s;
    }));
    const grouped = state.settings.taskbar.grouping === 'always';
    const list = [];
    for (const app of SAMPLE) {
      if (app.windows.length > 1 && grouped) list.push(button(app, app.name, app.windows.length));
      else app.windows.forEach((w) => list.push(button(app, w)));
    }
    tasksEl.replaceChildren(...list);
    tick();
  }

  function tick() {
    if (!state) return;
    const c = state.settings.clock;
    const text = window.clockText(new Date(), c);
    timeEl.textContent = text.time;
    dateEl.textContent = text.date;
    clock.classList.toggle('with-date', !!c.showDate);
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || !e.data || !e.data.state) return;
    state = e.data.state;
    icons = e.data.icons || {};
    status = e.data.status || null;
    window.applyTheme(state);
    render();
  });
  setInterval(tick, 1000);
})();
