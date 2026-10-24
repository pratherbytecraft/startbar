(function () {
  // The buttons on the bar. Only a window pulled out of its group is loose,
  // and the first button of a pinned app in the row carries the pin.
  type AppItem = { kind: 'app'; app: TaskApp; loose?: undefined; pin?: string };
  type WindowItem = { kind: 'window'; app: TaskApp; win: TaskWindow; loose?: true; pin?: string };
  type GroupItem = { kind: 'group'; app: TaskApp; wins: TaskWindow[]; loose?: undefined; pin?: string };
  type TaskItem = AppItem | WindowItem | GroupItem;
  type BarItem = TaskItem | { kind: 'pin'; path: string } | { kind: 'slot' };
  // A button being dragged along the bar, see moveByDrag. The fields after
  // moved are filled in once it moves.
  type Press = {
    el: HTMLElement; x: number; y: number; moved: boolean;
    els: HTMLElement[]; rects: DOMRect[]; from: number; to: number; step: number;
    target: HTMLElement | null | undefined; group: HTMLElement | null | undefined;
  };
  // The Shotdrawer button has no reading.
  type TrayStatus = Status & { shotdrawer?: undefined };

  const api = window.startbar;
  let state = null as unknown as State; // null until getState answers, which the drawing checks
  // Every element looked up here is in index.html.
  const start = document.getElementById('start')!;
  const clock = document.getElementById('clock')!;
  const timeEl = document.getElementById('time')!;
  const dateEl = document.getElementById('date')!;
  const tasksEl = document.getElementById('tasks')!;
  const quickEl = document.getElementById('quick')!;
  const trayEl = document.getElementById('tray-icons')!;
  const chevEl = document.getElementById('chev')!;
  let status = { volume: null, wifi: null, battery: null } as TrayStatus; // until the first reading
  let trayDrawn = '';

  // Narrowest a button with a label gets before windows are grouped or
  // labels drop.
  const LABEL_MIN = 90;
  const GAP = 4;

  let tasks: Tasks & Partial<TaskState> = { accessibility: null, apps: [] };
  let ungrouped = new Set<string>(); // ids of windows pulled out of their group, see main/ungrouped.ts
  let dragSlot: number | null = null; // the pid of the app whose window is being dragged onto this bar, see main/index.ts dragOut
  // Which display this bar is on: { id, main, bars, displays: [{ id, main, bounds }] }.
  let place: BarPlace | null = null;
  let drawn = '';
  let shownList: BarItem[] = []; // the items drawn on the bar, in their order
  let moving: Press | null = null; // the button being dragged along the bar, see moveByDrag
  let pinsDrawn = '';
  let tipTimer: number | null = null;
  const icons = new Map<string, string>(); // app path -> data URL
  const glows = new Map<string, string>(); // app path -> the icon's main color, for themes that light buttons with it
  let glowRedraw = 0;
  const asked = new Set<string>(); // app paths whose icon has been requested

  start.addEventListener('click', () => api.clickStart());

  // The corner counts as the Start button: the bar's edge left of it, below
  // it and above it, so throwing the mouse into the bottom left corner hits.
  const barEl = document.querySelector<HTMLElement>('.bar')!;
  const inCorner = (e: MouseEvent) => e.target === barEl && e.clientX <= start.getBoundingClientRect().right;
  barEl.addEventListener('click', (e) => {
    if (inCorner(e)) api.clickStart();
  });
  barEl.addEventListener('mousemove', (e) => start.classList.toggle('hot', inCorner(e)));
  barEl.addEventListener('mouseleave', () => start.classList.remove('hot'));

  const desk = document.getElementById('desk')!;
  desk.addEventListener('click', () => {
    hideTip();
    api.taskCommand({ cmd: 'showDesktop' });
  });
  desk.addEventListener('mouseenter', () => {
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => api.showTip({ text: 'Show Desktop', rect: rectOf(desk) }), 500);
  });
  desk.addEventListener('mouseleave', () => hideTip());
  document.querySelector('.bar')!.addEventListener('contextmenu', (e) => {
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

  function trayIcon(kind: TrayKind) {
    const b = document.createElement('span');
    b.className = 'tray-icon';
    b.dataset.kind = kind;
    b.innerHTML = window.trayIcons[kind](status[kind] as TrayReading); // each kind reads its own
    b.addEventListener('click', () => {
      hideTip();
      api.trayClick(kind, rectOf(b));
    });
    b.addEventListener('mouseenter', () => {
      clearTimeout(tipTimer);
      // The Shotdrawer button has no reading behind it, only its tooltip.
      const has = kind === 'shotdrawer' || status[kind];
      tipTimer = setTimeout(() => has && api.showTip({ text: window.trayIcons.tip(kind, status[kind] as TrayReading), rect: rectOf(b) }), 500);
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
    const all = window.trayIcons.shown(state.settings, status, state.shotdrawer);
    const collapsed = t.collapseArrow && t.collapsed;
    chevEl.classList.toggle('hidden', !t.collapseArrow || all.length === 0);
    chevEl.textContent = collapsed ? '‹' : '›';
    const kinds = collapsed ? [] : all;
    const key = JSON.stringify(kinds.map((k) => window.trayIcons[k](status[k] as TrayReading)));
    if (key === trayDrawn) return;
    trayDrawn = key;
    trayEl.replaceChildren(...kinds.map(trayIcon));
  }

  // The clock and tray can stay on the main display's bar only.
  function renderPlace() {
    if (!state || !place) return;
    const d = state.settings.displays;
    const hide = place.bars > 1 && d.bars === 'all' && d.tray === 'main' && !place.main;
    document.querySelector('.tray')!.classList.toggle('hidden', hide);
  }

  function applyStatus(next: Status) {
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

  function fetchIcons(paths: string[]) {
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
  function findGlow(p: string, url: string) {
    const img = new Image();
    img.onload = () => {
      const size = 16;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!; // a 2d canvas always has one
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

  const appName = (p: string) => p.split('/').pop()!.replace(/\.app$/, ''); // split gives at least one part

  // MARK: pinned apps

  function pinButton(p: string) {
    const b = document.createElement('div');
    b.className = 'icon';
    b.dataset.key = p;
    const img = document.createElement('img');
    img.alt = '';
    if (icons.get(p)) img.src = icons.get(p)!; // just checked
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

  const pinsKey = (list: string[]) => JSON.stringify(list.map((p) => [p, !!icons.get(p)]));

  // Pins in the row with the windows instead of their own spot.
  const pinsInRow = (t: TaskbarSettings) => t.showPins && t.pinsPlace === 'row';

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
  function inRow(list: TaskItem[], pinList: string[]) {
    const out: BarItem[] = [];
    const used = new Set<TaskItem>();
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
  // Asked only while perDisplay(), which needs a place.
  function displayOf(w: TaskWindow) {
    const cx = w.x + w.w / 2;
    const cy = w.y + w.h / 2;
    const hit = place!.displays.find(({ bounds: b }) => cx >= b.x && cx < b.x + b.width && cy >= b.y && cy < b.y + b.height);
    return (hit || place!.displays.find((d) => d.main) || place!.displays[0]).id;
  }

  // The buttons, left to right, before grouping. Without the Accessibility
  // permission there are no windows to show, so every app gets one button.
  // Buttons that aren't windows go on the main display's bar.
  function buildItems(t: TaskbarSettings): TaskItem[] {
    // place is set whenever perDisplay() is true.
    const mine = perDisplay() ? (w: TaskWindow) => displayOf(w) === place!.id : () => true;
    const otherSpaces = state.settings.spaces.show === 'all';
    const appsHere = !perDisplay() || place!.main;
    if (!tasks.accessibility) return appsHere ? tasks.apps.map((a) => ({ kind: 'app', app: a })) : [];
    const wins: WindowItem[] = [];
    const windowless: AppItem[] = [];
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
      const first = new Map<number, number>();
      for (const item of wins) if (!first.has(item.app.pid)) first.set(item.app.pid, item.win.order);
      wins.sort((x, y) => first.get(x.app.pid)! - first.get(y.app.pid)! || x.win.order - y.win.order); // every pid was set just above
    }
    return (wins as TaskItem[]).concat(windowless); // windows, then apps
  }

  // Each grouped app's windows fold into one button where its first window
  // was. A window pulled out of the group keeps its own button, right after
  // the group.
  function collapse(items: TaskItem[], grouped: Set<number>): TaskItem[] {
    let out: TaskItem[] = [];
    const groups = new Map<number, GroupItem>();
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
  function arrange(items: TaskItem[], mode: TaskbarSettings['grouping'], width: number) {
    const counts = new Map<number, number>();
    for (const item of items) if (item.kind === 'window') counts.set(item.app.pid, (counts.get(item.app.pid) || 0) + 1);
    const grouped = new Set<number>();
    if (mode === 'always') for (const [pid, n] of counts) if (n > 1) grouped.add(pid);
    const fits = (n: number) => n * LABEL_MIN + (n - 1) * GAP <= width;
    let list = collapse(items, grouped);
    while (mode !== 'never' && !fits(list.length)) {
      const next = [...counts].filter(([pid, n]) => n > 1 && !grouped.has(pid)).sort((x, y) => y[1] - x[1])[0];
      if (!next) break;
      grouped.add(next[0]);
      list = collapse(items, grouped);
    }
    return { list, compact: !fits(list.length) };
  }

  // What the last click clicked of a window, until the helper's window list
  // shows it. The bar draws the button that way right away, and a click
  // right after one that minimized or restored a window goes by it instead
  // of the old list, which takes a second or so to catch up during the
  // animation and would otherwise do the same thing again.
  let clicked: { id: string; active: boolean; at: number } | null = null; // { id, active, at }
  const pendingClick = () => (clicked && Date.now() - clicked.at < 3000 ? clicked : null);
  function settleAsked() {
    if (!clicked) return;
    // clicked is set, checked above, and win is one of app's windows.
    const app = tasks.apps.find((a) => a.windows.some((w) => w.id === clicked!.id));
    const win = app && app.windows.find((w) => w.id === clicked!.id);
    if (!win || listActive({ kind: 'window', app, win } as WindowItem) === clicked.active) clicked = null;
  }

  function isActive(item: TaskItem) {
    const c = pendingClick();
    if (c && item.kind === 'window' && item.win.id === c.id) return c.active;
    // Another window is coming forward.
    if (c && c.active) return false;
    return listActive(item);
  }

  function listActive(item: TaskItem) {
    if (!item.app.active) return false;
    if (item.kind === 'app') return true;
    // An app whose focus is on a sheet or panel reports no focused window.
    // With only one window open, that one is still the active one.
    const open = item.app.windows.filter((w) => !w.minimized);
    const focused = open.find((w) => w.focused) || (open.length === 1 ? open[0] : null);
    if (!focused) return false;
    return item.kind === 'group' ? item.wins.includes(focused) : item.win === focused;
  }

  function isDim(item: TaskItem) {
    if (item.app.hidden) return true;
    const c = pendingClick();
    if (c && item.kind === 'window' && item.win.id === c.id) return !c.active;
    if (item.kind === 'window') return item.win.minimized;
    if (item.kind === 'group') return item.wins.every((w) => w.minimized);
    return false;
  }

  function hideTip() {
    clearTimeout(tipTimer);
    tipTimer = null;
    api.hideTip();
  }

  function rectOf(el: Element) {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }

  // MARK: window previews

  // Shown after a short hover, and right away when moving from one button
  // to the next while they're up.
  let previewTimer: number | null = null;
  let previewUp = false;
  let previewLeft = 0;
  const previewsOn = () => state.settings.taskbar.previews;

  function previewPayload(item: WindowItem | GroupItem, el: HTMLElement) {
    const wins = item.kind === 'group' ? item.wins : [item.win];
    return {
      pid: item.app.pid,
      group: item.kind === 'group',
      rect: rectOf(el),
      icon: icons.get(item.app.path) || '',
      windows: wins.map((w) => ({ id: w.id, title: w.title || item.app.name, minimized: w.minimized, active: item.app.active && w.focused && !w.minimized }))
    };
  }

  function schedulePreview(item: WindowItem | GroupItem, el: HTMLElement) {
    clearTimeout(previewTimer);
    const show = () => {
      // The bar may have been drawn again since, which leaves el off the
      // page, where it measures as the corner and never hears the mouse leave.
      const now = el.isConnected ? el : ([...tasksEl.children] as HTMLElement[]).find((x) => x.dataset.order === el.dataset.order);
      if (!now || !now.matches(':hover')) return;
      previewUp = true;
      api.showPreview(previewPayload(item, now));
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

  function onClick(item: TaskItem, el: HTMLElement) {
    hideTip();
    const t = state.settings.taskbar;
    if (item.kind === 'app') {
      hidePreview();
      return api.taskCommand({ cmd: 'activateApp', pid: item.app.pid });
    }
    // With previews on, a click on a group keeps its pictures open instead
    // of showing the list.
    if (item.kind === 'group' && previewsOn()) {
      clearTimeout(previewTimer);
      previewUp = false;
      return api.pinPreview(previewPayload(item, el));
    }
    hidePreview();
    if (item.kind === 'group') {
      return api.showGroup({
        pid: item.app.pid,
        rect: rectOf(el),
        icon: icons.get(item.app.path) || '',
        windows: item.wins.map((w) => ({ id: w.id, title: w.title || item.app.name, minimized: w.minimized, active: item.app.active && w.focused && !w.minimized }))
      });
    }
    // The button can be from an older list, since the bar redraws only when
    // something on it changes, so go by the window in the newest one.
    const id = item.win.id;
    const app = tasks.apps.find((a) => a.windows.some((w) => w.id === id));
    const now = app ? { ...item, app, win: app.windows.find((w) => w.id === id)! } : item; // the find above found it
    const minimize = isActive(now) && t.clickActiveMinimizes;
    clicked = { id, active: !minimize, at: Date.now() };
    api.taskCommand({ cmd: minimize ? 'minimize' : 'activate', id: item.win.id });
    renderTasks();
  }

  function pinTask(p: string) {
    const b = document.createElement('div');
    b.className = 'task pinned';
    b.dataset.key = p;
    if (glows.has(p)) b.style.setProperty('--glow', glows.get(p)!); // just checked
    const img = document.createElement('img');
    img.alt = '';
    if (icons.get(p)) img.src = icons.get(p)!; // just checked
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

  function button(item: BarItem) {
    if (item.kind === 'pin') return pinTask(item.path);
    if (item.kind === 'slot') {
      const s = document.createElement('div');
      s.className = 'task slot';
      return s;
    }
    const b = document.createElement('div');
    b.className = 'task' + (isActive(item) ? ' active' : '') + (isDim(item) ? ' dim' : '');
    if (glows.has(item.app.path)) b.style.setProperty('--glow', glows.get(item.app.path)!); // just checked
    if (item.pin) b.dataset.key = item.pin;
    // For putting a pulled out window back by dragging its button onto
    // its app's group, see moveByDrag.
    if (item.loose) {
      // The DOM turns the pids into strings.
      b.dataset.loose = item.win.id;
      b.dataset.pid = item.app.pid as unknown as string;
    }
    if (item.kind === 'group') b.dataset.group = item.app.pid as unknown as string;
    b.dataset.order = window.orderKey(item); // found again after a redraw, see moveByDrag
    const img = document.createElement('img');
    img.alt = '';
    if (icons.get(item.app.path)) img.src = icons.get(item.app.path)!; // just checked
    b.append(img);
    if (item.kind === 'group') {
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = item.wins.length as unknown as string; // the DOM turns it into a string
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
      if (moving || tasksEl.matches('.reordering, .regrouping')) return;
      // With previews on, the preview has the title, so no tooltip. A
      // window that's on screen is pictured now, so a click that minimizes
      // it doesn't wait for a picture.
      if (previewsOn() && item.kind === 'window' && !item.win.minimized) api.warmPicture(item.win.id);
      if (previewsOn() && item.kind !== 'app') return schedulePreview(item, b);
      if (!state.settings.taskbar.titleOnHover) return;
      clearTimeout(tipTimer);
      tipTimer = setTimeout(() => api.showTip({ text: label.textContent!, rect: rectOf(b) }), 500); // the label's text is set above
    });
    b.addEventListener('mouseleave', () => {
      hideTip();
      if (previewsOn()) leavePreview();
    });
    return b;
  }

  // Any button but a pin's can be dragged to a new spot on the bar: it
  // follows the mouse, the others slide aside to make room, and on letting go
  // it glides into its spot and the new order is saved (main/order.ts). A
  // window pulled out of its group, dropped on the middle of its app's group,
  // goes back in instead; the group lights up as the target. A press that
  // moves less than a few pixels stays a click. Pins in the row reorder
  // through reorderable above.
  function moveByDrag() {
    const THRESHOLD = 4;
    const SETTLE = 160; // the glide into place, as long as the slide in base.css
    let press: Press | null = null;
    let swallowClick = false;
    const movable = (el: HTMLElement) => el.classList.contains('task') && !el.dataset.key && !el.classList.contains('slot');
    tasksEl.addEventListener('pointerdown', (e) => {
      swallowClick = false;
      if (e.button !== 0 || moving) return;
      const el = (e.target as HTMLElement).closest<HTMLElement>('.task');
      if (!el || el.parentElement !== tasksEl || !movable(el)) return;
      press = { el, x: e.clientX, y: e.clientY, moved: false } as Press; // the rest once it moves
    });
    tasksEl.addEventListener('pointermove', (e) => {
      if (!press) return;
      if (!press.moved) {
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < THRESHOLD) return;
        press.moved = true;
        try { tasksEl.setPointerCapture(e.pointerId); } catch {}
        // The window list comes in a few times a second and can redraw the
        // bar between the press and the drag, so find the button again.
        if (!press.el.isConnected) {
          // Typed as found; the null is checked right below.
          press.el = (([...tasksEl.children] as HTMLElement[]).find((x) => x.dataset.order === press!.el.dataset.order) || null) as HTMLElement;
          if (!press.el) { press = null; return; }
        }
        const els = ([...tasksEl.children] as HTMLElement[]).filter(movable);
        const rects = els.map((x) => x.getBoundingClientRect());
        const from = els.indexOf(press.el);
        const style = getComputedStyle(press.el);
        Object.assign(press, {
          els, rects, from, to: from, target: null,
          step: rects[from].width + parseFloat(style.marginRight) + GAP,
          group: press.el.dataset.loose ? els.find((x) => x.dataset.group === press!.el.dataset.pid) : null
        });
        moving = press;
        press.el.classList.add('held');
        tasksEl.classList.add('moving');
        hideTip();
        hidePreview();
      }
      const p = press;
      const first = p.rects[0].left;
      const last = p.rects[p.rects.length - 1].right;
      const dx = Math.min(Math.max(e.clientX - p.x, first - p.rects[p.from].left), last - p.rects[p.from].right);
      p.el.style.transform = `translateX(${dx}px)`;
      // Over the middle half of its own group, a pulled out window goes back in.
      const g = p.group ? p.rects[p.els.indexOf(p.group)] : null;
      p.target = g && e.clientX > g.left + g.width / 4 && e.clientX < g.right - g.width / 4 ? p.group : null;
      if (p.group) p.group.classList.toggle('target', !!p.target);
      // Its new spot: after every other button whose middle it has passed.
      const mid = p.rects[p.from].left + p.rects[p.from].width / 2 + dx;
      p.to = p.target ? p.from : p.rects.filter((r, i) => i !== p.from && r.left + r.width / 2 < mid).length;
      p.els.forEach((x, i) => {
        if (i === p.from) return;
        const shift = i > p.from && i <= p.to ? -p.step : i < p.from && i >= p.to ? p.step : 0;
        x.style.transform = shift ? `translateX(${shift}px)` : '';
      });
    });
    const end = (e: PointerEvent) => {
      if (!press) return;
      const p = press;
      press = null;
      if (!p.moved) return;
      swallowClick = true; // the click that ends a drag isn't a click
      if (p.group) p.group.classList.remove('target');
      const done = () => {
        moving = null;
        tasksEl.classList.remove('moving');
        drawn = '';
        renderTasks();
      };
      if (p.target && e.type === 'pointerup') {
        api.regroup(p.el.dataset.loose!); // only a loose button has a target
        done();
        return;
      }
      // Glide into the spot it was dropped on (or back), then draw the bar in
      // the new order, which by then looks the same.
      const to = e.type === 'pointerup' ? p.to : p.from;
      p.el.classList.remove('held');
      p.el.classList.add('settling');
      p.el.style.transform = `translateX(${p.rects[to].left - p.rects[p.from].left}px)`;
      if (to !== p.from) {
        const items = shownList.filter((item) => item.kind !== 'pin' && item.kind !== 'slot' && !item.pin);
        const [item] = items.splice(p.from, 1);
        items.splice(to, 0, item);
        const keys = window.orderKeys(items);
        tasks = { ...tasks, order: keys.concat((tasks.order || []).filter((k) => !keys.includes(k))) };
        api.setOrder(keys);
      }
      setTimeout(done, SETTLE);
    };
    tasksEl.addEventListener('pointerup', end);
    tasksEl.addEventListener('pointercancel', end);
    tasksEl.addEventListener('click', (e) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopPropagation();
      e.preventDefault();
    }, true);
  }
  moveByDrag();

  // A redraw between pressing a button and letting go swaps the button
  // under the mouse, and the page drops a click whose press and release
  // land on different elements. The list changes most right after a click,
  // when the next one is likely, so redraws wait for the release and come
  // after the click.
  let pressing = false;
  tasksEl.addEventListener('pointerdown', (e) => {
    if (e.button === 0) pressing = true;
  });
  const release = () => {
    if (!pressing) return;
    pressing = false;
    setTimeout(renderTasks);
  };
  window.addEventListener('pointerup', release, true);
  window.addEventListener('pointercancel', release, true);
  window.addEventListener('blur', release);

  // The helper sends the list a few times a second, so only redraw when
  // something on the bar would change.
  function renderTasks() {
    if (!state || pressing || moving || tasksEl.matches('.reordering, .regrouping')) return;
    const t = state.settings.taskbar;
    const pinList = pinsInRow(t) ? state.pins : [];
    const items = buildItems(t);
    // Pins that aren't open take an icon's width out of the row.
    const open = new Set(items.map((item) => item.app.path));
    const closed = pinList.filter((p) => !open.has(p)).length;
    const width = tasksEl.clientWidth - 8 - closed * (state.settings.barHeight * 1.5 + GAP); // .tasks has 4px padding each side
    const arranged = arrange(items, t.grouping, width);
    const compact = arranged.compact;
    // Buttons dragged to a spot of their own keep it (shared/order.ts).
    const ordered = window.byOrder(arranged.list, tasks.order);
    const list: BarItem[] = pinList.length ? inRow(ordered, pinList) : ordered;
    // While a window is dragged out of its group, the slot where its button
    // lands: after the app's last button, or at the end.
    if (dragSlot !== null) {
      let at = list.length - 1;
      list.forEach((item, i) => { if (item.kind !== 'pin' && (item as TaskItem).app.pid === dragSlot) at = i; }); // no slot yet
      list.splice(at + 1, 0, { kind: 'slot' });
    }
    const key = JSON.stringify([compact, t, place, state.settings.displays, state.settings.spaces, pinList, list.map((item) => item.kind === 'pin' ? ['pin', item.path] : item.kind === 'slot' ? ['slot'] : [
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
    shownList = list;
    tasksEl.replaceChildren(...list.map(button));
    fetchIcons(tasks.apps.map((a) => a.path).concat(pinList));
  }

  function applyTasks(next: TaskState) {
    tasks = next;
    settleAsked();
    ungrouped = new Set(next.ungrouped || []);
    renderTasks();
  }

  function apply(next: State) {
    state = next;
    window.applyTheme(state);
    tick();
    renderPins();
    renderTray();
    renderPlace();
    renderTasks();
  }

  api.onDragOver((d) => {
    dragSlot = d ? d.pid : null;
    drawn = '';
    renderTasks();
  });

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
