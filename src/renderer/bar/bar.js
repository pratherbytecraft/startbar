(function () {
  const api = window.startbar;
  let state = null;
  const start = document.getElementById('start');
  const clock = document.getElementById('clock');
  const timeEl = document.getElementById('time');
  const dateEl = document.getElementById('date');
  const tasksEl = document.getElementById('tasks');
  const quickEl = document.getElementById('quick');
  const trayEl = document.getElementById('tray-icons');
  const chevEl = document.getElementById('chev');
  let status = { volume: null, wifi: null, battery: null };
  let trayDrawn = '';

  // Narrowest a button with a label gets before windows are grouped or
  // labels drop.
  const LABEL_MIN = 90;
  const GAP = 4;

  let tasks = { accessibility: null, apps: [] };
  let ungrouped = new Set(); // ids of windows pulled out of their group, see main/ungrouped.js
  // Which display this bar is on: { id, main, bars, displays: [{ id, main, bounds }] }.
  let place = null;
  let drawn = '';
  let pinsDrawn = '';
  let tipTimer = null;
  const icons = new Map(); // app path -> data URL
  const glows = new Map(); // app path -> the icon's main color, for themes that light buttons with it
  let glowRedraw = 0;
  const asked = new Set(); // app paths whose icon has been requested

  start.addEventListener('click', () => api.clickStart());

  // The corner counts as the Start button: the bar's edge left of it, below
  // it and above it, so throwing the mouse into the bottom left corner hits.
  const barEl = document.querySelector('.bar');
  const inCorner = (e) => e.target === barEl && e.clientX <= start.getBoundingClientRect().right;
  barEl.addEventListener('click', (e) => {
    if (inCorner(e)) api.clickStart();
  });
  barEl.addEventListener('mousemove', (e) => start.classList.toggle('hot', inCorner(e)));
  barEl.addEventListener('mouseleave', () => start.classList.remove('hot'));

  const desk = document.getElementById('desk');
  desk.addEventListener('click', () => {
    hideTip();
    api.taskCommand({ cmd: 'showDesktop' });
  });
  desk.addEventListener('mouseenter', () => {
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => api.showTip({ text: 'Show Desktop', rect: rectOf(desk) }), 500);
  });
  desk.addEventListener('mouseleave', () => hideTip());
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
  }

  // MARK: tray

  function trayIcon(kind) {
    const b = document.createElement('span');
    b.className = 'tray-icon';
    b.dataset.kind = kind;
    b.innerHTML = window.trayIcons[kind](status[kind]);
    b.addEventListener('click', () => {
      hideTip();
      api.trayClick(kind, rectOf(b));
    });
    b.addEventListener('mouseenter', () => {
      clearTimeout(tipTimer);
      tipTimer = setTimeout(() => status[kind] && api.showTip({ text: window.trayIcons.tip(kind, status[kind]), rect: rectOf(b) }), 500);
    });
    b.addEventListener('mouseleave', hideTip);
    return b;
  }

  // The arrow hides the tray icons behind one click and remembers it.
  chevEl.addEventListener('click', () => {
    hideTip();
    api.updateSettings({ tray: { collapsed: !state.settings.tray.collapsed } });
  });
  chevEl.addEventListener('mouseenter', () => {
    clearTimeout(tipTimer);
    const text = state.settings.tray.collapsed ? 'Show the tray icons' : 'Hide the tray icons';
    tipTimer = setTimeout(() => api.showTip({ text, rect: rectOf(chevEl) }), 500);
  });
  chevEl.addEventListener('mouseleave', hideTip);

  // Redrawn only when an icon would look different.
  function renderTray() {
    if (!state) return;
    const t = state.settings.tray;
    const all = window.trayIcons.shown(state.settings, status);
    const collapsed = t.collapseArrow && t.collapsed;
    chevEl.classList.toggle('hidden', !t.collapseArrow || all.length === 0);
    chevEl.textContent = collapsed ? '‹' : '›';
    const kinds = collapsed ? [] : all;
    const key = JSON.stringify(kinds.map((k) => window.trayIcons[k](status[k])));
    if (key === trayDrawn) return;
    trayDrawn = key;
    trayEl.replaceChildren(...kinds.map(trayIcon));
  }

  // The clock and tray can stay on the main display's bar only.
  function renderPlace() {
    if (!state || !place) return;
    const d = state.settings.displays;
    const hide = place.bars > 1 && d.bars === 'all' && d.tray === 'main' && !place.main;
    document.querySelector('.tray').classList.toggle('hidden', hide);
  }

  function applyStatus(next) {
    status = next || status;
    renderTray();
  }

  // The full date in our tooltip on hover, whatever the click does.
  clock.addEventListener('mouseenter', () => {
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => api.showTip({ text: window.clockText(new Date(), state.settings.clock).full, rect: rectOf(clock) }), 500);
  });
  clock.addEventListener('mouseleave', () => hideTip());
  clock.addEventListener('click', () => {
    hideTip();
    api.clockClick(rectOf(clock));
  });

  function fetchIcons(paths) {
    const missing = paths.filter((p) => p && !asked.has(p));
    if (missing.length === 0) return;
    missing.forEach((p) => asked.add(p));
    api.taskIcons(missing).then((found) => {
      for (const [p, url] of Object.entries(found)) {
        icons.set(p, url);
        if (url) findGlow(p, url);
      }
      drawn = '';
      renderTasks();
      renderPins();
    });
  }

  // The average of an icon's colored pixels, brightened. Grey pixels count
  // for little, so a colorful badge on a grey icon still wins.
  function findGlow(p, url) {
    const img = new Image();
    img.onload = () => {
      const size = 16;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, size, size);
      const d = ctx.getImageData(0, 0, size, size).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue;
        const w = (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2])) / 255 + 0.05;
        r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; n += w;
      }
      if (!n) return;
      const k = 255 / Math.max(r / n, g / n, b / n, 1);
      glows.set(p, `rgb(${Math.round((r / n) * k)}, ${Math.round((g / n) * k)}, ${Math.round((b / n) * k)})`);
      cancelAnimationFrame(glowRedraw);
      glowRedraw = requestAnimationFrame(() => {
        drawn = '';
        renderTasks();
      });
    };
    img.src = url;
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

  // Pins in the row with the windows instead of their own spot.
  const pinsInRow = (t) => t.showPins && t.pinsPlace === 'row';

  function renderPins() {
    if (!state) return;
    const t = state.settings.taskbar;
    const list = t.showPins && !pinsInRow(t) ? state.pins : [];
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

  // In the row, each pin takes its place in pin order: the app's buttons if
  // it's open, a bare icon if not. The first button of each carries the pin,
  // so dragging it reorders the pins.
  function inRow(list, pinList) {
    const out = [];
    const used = new Set();
    for (const p of pinList) {
      const mine = list.filter((item) => item.app.path === p);
      if (mine.length === 0) out.push({ kind: 'pin', path: p });
      // A window pulled out of its group carries the pin only when nothing
      // else of the app's can, so dragging it isn't a pin reorder.
      const carrier = mine.find((item) => !item.loose) || mine[0];
      for (const item of mine) {
        used.add(item);
        out.push(item === carrier ? { ...item, pin: p } : item);
      }
    }
    return out.concat(list.filter((item) => !used.has(item)));
  }

  window.reorderable(tasksEl, {
    axis: 'x',
    onStart: hideTip,
    onDrop: (order) => {
      drawn = '';
      api.setPins(order);
    }
  });

  // With a bar on each display and buttons per display, whether this bar
  // shows only its own display's windows.
  function perDisplay() {
    const d = state.settings.displays;
    return !!place && place.bars > 1 && d.bars === 'all' && d.buttons === 'display';
  }

  // The display a window is on: the one with its middle, else the main one.
  function displayOf(w) {
    const cx = w.x + w.w / 2;
    const cy = w.y + w.h / 2;
    const hit = place.displays.find(({ bounds: b }) => cx >= b.x && cx < b.x + b.width && cy >= b.y && cy < b.y + b.height);
    return (hit || place.displays.find((d) => d.main) || place.displays[0]).id;
  }

  // The buttons, left to right, before grouping. Without the Accessibility
  // permission there are no windows to show, so every app gets one button.
  // Buttons that aren't windows go on the main display's bar.
  function buildItems(t) {
    const mine = perDisplay() ? (w) => displayOf(w) === place.id : () => true;
    const otherSpaces = state.settings.spaces.show === 'all';
    const appsHere = !perDisplay() || place.main;
    if (!tasks.accessibility) return appsHere ? tasks.apps.map((a) => ({ kind: 'app', app: a })) : [];
    const wins = [];
    const windowless = [];
    for (const a of tasks.apps) {
      // Minimized windows and hidden apps are off screen but still belong
      // on the bar. Windows on other Spaces only show when asked for.
      const all = a.windows.filter((w) => w.onScreen || w.minimized || a.hidden || (otherSpaces && w.otherSpace));
      const list = all.filter(mine);
      if (all.length === 0) {
        if (t.showWindowless && appsHere) windowless.push({ kind: 'app', app: a });
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

  // Each grouped app's windows fold into one button where its first window
  // was. A window pulled out of the group keeps its own button, right after
  // the group.
  function collapse(items, grouped) {
    let out = [];
    const groups = new Map();
    for (const item of items) {
      if (item.kind !== 'window' || !grouped.has(item.app.pid)) {
        out.push(item);
        continue;
      }
      if (ungrouped.has(item.win.id)) {
        out.push({ ...item, loose: true });
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
    for (const g of groups.values()) {
      const loose = out.filter((item) => item.loose && item.app.pid === g.app.pid);
      if (!loose.length) continue;
      out = out.filter((item) => !loose.includes(item));
      out.splice(out.indexOf(g) + 1, 0, ...loose);
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

  // MARK: window previews

  // Shown after a short hover, and right away when moving from one button
  // to the next while they're up.
  let previewTimer = null;
  let previewUp = false;
  let previewLeft = 0;
  const previewsOn = () => state.settings.taskbar.previews;

  function schedulePreview(item, el) {
    clearTimeout(previewTimer);
    const wins = item.kind === 'group' ? item.wins : [item.win];
    const show = () => {
      previewUp = true;
      api.showPreview({
        pid: item.app.pid,
        group: item.kind === 'group',
        rect: rectOf(el),
        icon: icons.get(item.app.path) || '',
        windows: wins.map((w) => ({ id: w.id, title: w.title || item.app.name, minimized: w.minimized, active: item.app.active && w.focused && !w.minimized }))
      });
    };
    if (previewUp && Date.now() - previewLeft < 300) show();
    else previewTimer = setTimeout(show, 500);
  }

  function leavePreview() {
    clearTimeout(previewTimer);
    previewLeft = Date.now();
    api.leavePreview();
    setTimeout(() => { if (Date.now() - previewLeft >= 300) previewUp = false; }, 320);
  }

  function hidePreview() {
    clearTimeout(previewTimer);
    previewUp = false;
    api.hidePreview();
  }

  function onClick(item, el) {
    hideTip();
    hidePreview();
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

  function pinTask(p) {
    const b = document.createElement('div');
    b.className = 'task pinned';
    b.dataset.key = p;
    if (glows.has(p)) b.style.setProperty('--glow', glows.get(p));
    const img = document.createElement('img');
    img.alt = '';
    if (icons.get(p)) img.src = icons.get(p);
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = appName(p);
    b.append(img, label);
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
      if (tasksEl.classList.contains('reordering')) return;
      clearTimeout(tipTimer);
      tipTimer = setTimeout(() => api.showTip({ text: appName(p), rect: rectOf(b) }), 500);
    });
    b.addEventListener('mouseleave', hideTip);
    return b;
  }

  function button(item) {
    if (item.kind === 'pin') return pinTask(item.path);
    const b = document.createElement('div');
    b.className = 'task' + (isActive(item) ? ' active' : '') + (isDim(item) ? ' dim' : '');
    if (glows.has(item.app.path)) b.style.setProperty('--glow', glows.get(item.app.path));
    if (item.pin) b.dataset.key = item.pin;
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
      hidePreview();
      api.taskMenu({
        kind: item.kind,
        pid: item.app.pid,
        id: item.kind === 'window' ? item.win.id : undefined,
        ids: item.kind === 'group' ? item.wins.map((w) => w.id) : undefined
      });
    });
    b.addEventListener('mouseenter', () => {
      if (tasksEl.classList.contains('reordering')) return;
      // With previews on, the preview has the title, so no tooltip.
      if (previewsOn() && item.kind !== 'app') return schedulePreview(item, b);
      if (!state.settings.taskbar.titleOnHover) return;
      clearTimeout(tipTimer);
      tipTimer = setTimeout(() => api.showTip({ text: label.textContent, rect: rectOf(b) }), 500);
    });
    b.addEventListener('mouseleave', () => {
      hideTip();
      if (previewsOn()) leavePreview();
    });
    return b;
  }

  // The helper sends the list a few times a second, so only redraw when
  // something on the bar would change.
  function renderTasks() {
    if (!state || tasksEl.classList.contains('reordering')) return;
    const t = state.settings.taskbar;
    const pinList = pinsInRow(t) ? state.pins : [];
    const items = buildItems(t);
    // Pins that aren't open take an icon's width out of the row.
    const open = new Set(items.map((item) => item.app.path));
    const closed = pinList.filter((p) => !open.has(p)).length;
    const width = tasksEl.clientWidth - 8 - closed * (state.settings.barHeight * 1.5 + GAP); // .tasks has 4px padding each side
    const arranged = arrange(items, t.grouping, width);
    const compact = arranged.compact;
    const list = pinList.length ? inRow(arranged.list, pinList) : arranged.list;
    const key = JSON.stringify([compact, t, place, state.settings.displays, state.settings.spaces, pinList, list.map((item) => item.kind === 'pin' ? ['pin', item.path] : [
      item.kind, item.app.pid, item.app.path, isActive(item), isDim(item),
      item.kind === 'window' ? [item.win.id, item.win.title] : item.kind === 'group' ? item.wins.map((w) => [w.id, w.title, w.minimized, w.focused]) : item.app.name
    ])]);
    if (key === drawn) return;
    drawn = key;
    // The hovered button may be gone, but only if it was one of these: a
    // window whose title keeps changing (a spinner in Terminal) shouldn't
    // take the tooltip away from a pin, the clock or the tray.
    if (tasksEl.matches(':hover')) hideTip();
    tasksEl.classList.toggle('compact', compact);
    tasksEl.replaceChildren(...list.map(button));
    fetchIcons(tasks.apps.map((a) => a.path).concat(pinList));
  }

  function applyTasks(next) {
    tasks = next;
    ungrouped = new Set(next.ungrouped || []);
    renderTasks();
  }

  function apply(next) {
    state = next;
    window.applyTheme(state);
    tick();
    renderPins();
    renderTray();
    renderPlace();
    renderTasks();
  }

  api.onBarPlace((next) => {
    place = next;
    renderPlace();
    renderTasks();
  });

  new ResizeObserver(() => renderTasks()).observe(tasksEl);
  api.getState().then(apply);
  api.onState(apply);
  api.getTasks().then(applyTasks);
  api.getStatus().then(applyStatus);
  api.onStatus(applyStatus);
  api.onTasks(applyTasks);
  setInterval(tick, 1000);
})();
