(function () {
  let state = null;
  const start = document.getElementById('start');
  const clock = document.getElementById('clock');
  const timeEl = document.getElementById('time');
  const dateEl = document.getElementById('date');
  const tasksEl = document.getElementById('tasks');

  let tasks = { accessibility: null, apps: [] };
  let drawn = '';
  const icons = new Map(); // app path -> data URL
  const asked = new Set(); // app paths whose icon has been requested

  start.addEventListener('click', () => window.startbar.clickStart());
  document.querySelector('.bar').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.startbar.barMenu();
  });
  window.startbar.onMenuState((open) => start.classList.toggle('open', !!open));

  function dateText(d, style) {
    switch (style) {
      case 'weekday': return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
      case 'numeric': return d.toLocaleDateString([], { year: '2-digit', month: 'numeric', day: 'numeric' });
      case 'dayFirst': return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      default: return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  }

  function tick() {
    if (!state) return;
    const c = state.settings.clock;
    const d = new Date();
    timeEl.textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: c.seconds ? '2-digit' : undefined, hour12: c.hour12 });
    dateEl.textContent = dateText(d, c.dateStyle);
    clock.classList.toggle('with-date', !!c.showDate);
    clock.title = d.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }

  function fetchIcons() {
    const missing = tasks.apps.map((a) => a.path).filter((p) => p && !asked.has(p));
    if (missing.length === 0) return;
    missing.forEach((p) => asked.add(p));
    window.startbar.taskIcons(missing).then((found) => {
      for (const [p, url] of Object.entries(found)) icons.set(p, url);
      drawn = '';
      renderTasks();
    });
  }

  function appButton(a) {
    const b = document.createElement('div');
    b.className = 'task' + (a.active ? ' active' : '') + (a.hidden ? ' dim' : '');
    b.title = a.name;
    const img = document.createElement('img');
    img.alt = '';
    if (icons.get(a.path)) img.src = icons.get(a.path);
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = a.name;
    b.append(img, label);
    b.addEventListener('click', () => window.startbar.taskCommand({ cmd: 'activateApp', pid: a.pid }));
    return b;
  }

  // One button per running app; a click brings the app forward. The helper
  // sends the list a few times a second, so only redraw when it changed.
  function renderTasks() {
    const key = JSON.stringify(tasks.apps.map((a) => [a.pid, a.name, a.path, a.active, a.hidden]));
    if (key === drawn) return;
    drawn = key;
    tasksEl.replaceChildren(...tasks.apps.map(appButton));
    fetchIcons();
  }

  function applyTasks(next) {
    tasks = next;
    renderTasks();
  }

  function apply(next) {
    state = next;
    window.applyTheme(state);
    tick();
  }

  window.startbar.getState().then(apply);
  window.startbar.onState(apply);
  window.startbar.getTasks().then(applyTasks);
  window.startbar.onTasks(applyTasks);
  setInterval(tick, 1000);
})();
