(function () {
  const api = window.startbar;
  let state = null;
  const start = document.getElementById('start');
  const clock = document.getElementById('clock');
  const timeEl = document.getElementById('time');
  const dateEl = document.getElementById('date');
  const tasksEl = document.getElementById('tasks');
  const quickEl = document.getElementById('quick');

  // Narrowest a button with a label gets before windows are grouped or
  // labels drop.
  const LABEL_MIN = 90;
  const GAP = 4;

  let tasks = { accessibility: null, apps: [] };
  let drawn = '';
  let pinsDrawn = '';
  let tipTimer = null;
  const icons = new Map(); // app path -> data URL
  const asked = new Set(); // app paths whose icon has been requested

  start.addEventListener('click', () => api.clickStart());
  document.querySelector('.bar').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    api.barMenu();
  });
  api.onMenuState((open) => start.classList.toggle('open', !!open));

  function tick() {
    if (!state) return;
    const c = state.settings.clock;
    const text = window.clockText(new Date(), c);
    timeEl.textContent = text.time;
    dateEl.textContent = text.date;
    clock.classList.toggle('with-date', !!c.showDate);
    clock.title = text.full;
  }

  function fetchIcons(paths) {
    const missing = paths.filter((p) => p && !asked.has(p));
    if (missing.length === 0) return;
    missing.forEach((p) => asked.add(p));
    api.taskIcons(missing).then((found) => {
      for (const [p, url] of Object.entries(found)) icons.set(p, url);
      drawn = '';
      renderTasks();
      renderPins();
    });
  }

  const appName = (p) => p.split('/').pop().replace(/\.app$/, '');

  // MARK: pinned apps

  function pinButton(p) {
    const b = document.createElement('div');
    b.className = 'icon';
    b.dataset.key = p;
    const img = document.createElement('img');
    img.alt = '';
    if (icons.get(p)) img.src = icons.get(p);
    b.append(img);
    b.addEventListener('click', () => {
      hideTip();
      api.launchPin(p);
    });
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideTip();
      api.pinMenu(p);
    });
    b.addEventListener('mouseenter', () => {
      if (quickEl.classList.contains('reordering')) return;
      clearTimeout(tipTimer);
      tipTimer = setTimeout(() => api.showTip({ text: appName(p), rect: rectOf(b) }), 500);
    });
    b.addEventListener('mouseleave', hideTip);
    return b;
  }

  const pinsKey = (list) => JSON.stringify(list.map((p) => [p, !!icons.get(p)]));

  function renderPins() {
    if (!state) return;
    const list = state.settings.taskbar.showPins ? state.pins : [];
    const key = pinsKey(list);
    if (key === pinsDrawn) return;
    pinsDrawn = key;
    quickEl.replaceChildren(...list.map(pinButton));
    fetchIcons(list);
  }

  window.reorderable(quickEl, {
    axis: 'x',
    onStart: hideTip,
    onDrop: (order) => {
      pinsDrawn = pinsKey(order); // already drawn in this order
      api.setPins(order);
    }
  });

  // The buttons, left to right, before grouping. Without the Accessibility
  // permission there are no windows to show, so every app gets one button.
  function buildItems(t) {
    if (!tasks.accessibility) return tasks.apps.map((a) => ({ kind: 'app', app: a }));
    const wins = [];
    const windowless = [];
    for (const a of tasks.apps) {
      // Minimized windows and hidden apps are off screen but still belong
      // on the bar. Windows on other Spaces only show when asked for.
      const list = a.windows.filter((w) => w.onScreen || w.minimized || a.hidden);
      if (list.length === 0) {
        if (t.showWindowless) windowless.push({ kind: 'app', app: a });
        continue;
      }
      for (const w of list) wins.push({ kind: 'window', app: a, win: w });
    }
    wins.sort((x, y) => x.win.order - y.win.order);
    if (t.order === 'app') {
      const first = new Map();
      for (const item of wins) if (!first.has(item.app.pid)) first.set(item.app.pid, item.win.order);
      wins.sort((x, y) => first.get(x.app.pid) - first.get(y.app.pid) || x.win.order - y.win.order);
    }
    return wins.concat(windowless);
  }

  // Each grouped app's windows fold into one button where its first window was.
  function collapse(items, grouped) {
    const out = [];
    const groups = new Map();
    for (const item of items) {
      if (item.kind !== 'window' || !grouped.has(item.app.pid)) {
        out.push(item);
        continue;
      }
      let g = groups.get(item.app.pid);
      if (!g) {
        g = { kind: 'group', app: item.app, wins: [] };
        groups.set(item.app.pid, g);
        out.push(g);
      }
      g.wins.push(item.win);
    }
    return out.map((item) => (item.kind === 'group' && item.wins.length === 1 ? { kind: 'window', app: item.app, win: item.wins[0] } : item));
  }

  // Grouping per the setting, then more grouping while the buttons would get
  // narrower than LABEL_MIN (biggest app first), then labels drop. No scrolling.
  function arrange(items, mode, width) {
    const counts = new Map();
    for (const item of items) if (item.kind === 'window') counts.set(item.app.pid, (counts.get(item.app.pid) || 0) + 1);
    const grouped = new Set();
    if (mode === 'always') for (const [pid, n] of counts) if (n > 1) grouped.add(pid);
    const fits = (n) => n * LABEL_MIN + (n - 1) * GAP <= width;
    let list = collapse(items, grouped);
    while (mode !== 'never' && !fits(list.length)) {
      const next = [...counts].filter(([pid, n]) => n > 1 && !grouped.has(pid)).sort((x, y) => y[1] - x[1])[0];
      if (!next) break;
      grouped.add(next[0]);
      list = collapse(items, grouped);
    }
    return { list, compact: !fits(list.length) };
  }

  function isActive(item) {
    if (!item.app.active) return false;
    if (item.kind === 'app') return true;
    // An app whose focus is on a sheet or panel reports no focused window.
    // With only one window open, that one is still the active one.
    const open = item.app.windows.filter((w) => !w.minimized);
    const focused = open.find((w) => w.focused) || (open.length === 1 ? open[0] : null);
    if (!focused) return false;
    return item.kind === 'group' ? item.wins.includes(focused) : item.win === focused;
  }

  function isDim(item) {
    if (item.app.hidden) return true;
    if (item.kind === 'window') return item.win.minimized;
    if (item.kind === 'group') return item.wins.every((w) => w.minimized);
    return false;
  }

  function hideTip() {
    clearTimeout(tipTimer);
    tipTimer = null;
    api.hideTip();
  }

  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }

  function onClick(item, el) {
    hideTip();
    const t = state.settings.taskbar;
    if (item.kind === 'app') return api.taskCommand({ cmd: 'activateApp', pid: item.app.pid });
    if (item.kind === 'group') {
      return api.showGroup({
        pid: item.app.pid,
        rect: rectOf(el),
        icon: icons.get(item.app.path) || '',
        windows: item.wins.map((w) => ({ id: w.id, title: w.title || item.app.name, minimized: w.minimized, active: item.app.active && w.focused && !w.minimized }))
      });
    }
    if (isActive(item) && t.clickActiveMinimizes) return api.taskCommand({ cmd: 'minimize', id: item.win.id });
    api.taskCommand({ cmd: 'activate', id: item.win.id });
  }

  function button(item) {
    const b = document.createElement('div');
    b.className = 'task' + (isActive(item) ? ' active' : '') + (isDim(item) ? ' dim' : '');
    const img = document.createElement('img');
    img.alt = '';
    if (icons.get(item.app.path)) img.src = icons.get(item.app.path);
    b.append(img);
    if (item.kind === 'group') {
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = item.wins.length;
      b.append(count);
    }
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = item.kind === 'window' ? item.win.title || item.app.name : item.app.name;
    b.append(label);
    if (item.kind === 'group') {
      const caret = document.createElement('span');
      caret.className = 'caret';
      b.append(caret);
    }

    b.addEventListener('click', () => onClick(item, b));
    b.addEventListener('auxclick', (e) => {
      if (e.button === 1) api.taskCommand({ cmd: 'newWindow', pid: item.app.pid });
    });
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideTip();
      api.taskMenu({
        kind: item.kind,
        pid: item.app.pid,
        id: item.kind === 'window' ? item.win.id : undefined,
        ids: item.kind === 'group' ? item.wins.map((w) => w.id) : undefined
      });
    });
    b.addEventListener('mouseenter', () => {
      if (!state.settings.taskbar.titleOnHover) return;
      clearTimeout(tipTimer);
      tipTimer = setTimeout(() => api.showTip({ text: label.textContent, rect: rectOf(b) }), 500);
    });
    b.addEventListener('mouseleave', hideTip);
    return b;
  }

  // The helper sends the list a few times a second, so only redraw when
  // something on the bar would change.
  function renderTasks() {
    if (!state) return;
    const t = state.settings.taskbar;
    const width = tasksEl.clientWidth - 8; // .tasks has 4px padding each side
    const { list, compact } = arrange(buildItems(t), t.grouping, width);
    const key = JSON.stringify([compact, t, list.map((item) => [
      item.kind, item.app.pid, item.app.path, isActive(item), isDim(item),
      item.kind === 'window' ? [item.win.id, item.win.title] : item.kind === 'group' ? item.wins.map((w) => [w.id, w.title, w.minimized, w.focused]) : item.app.name
    ])]);
    if (key === drawn) return;
    drawn = key;
    hideTip(); // the hovered button may be gone
    tasksEl.classList.toggle('compact', compact);
    tasksEl.replaceChildren(...list.map(button));
    fetchIcons(tasks.apps.map((a) => a.path));
  }

  function applyTasks(next) {
    tasks = next;
    renderTasks();
  }

  function apply(next) {
    state = next;
    window.applyTheme(state);
    tick();
    renderPins();
    renderTasks();
  }

  new ResizeObserver(() => renderTasks()).observe(tasksEl);
  api.getState().then(apply);
  api.onState(apply);
  api.getTasks().then(applyTasks);
  api.onTasks(applyTasks);
  setInterval(tick, 1000);
})();
