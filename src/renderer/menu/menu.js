(function () {
  const api = window.startbar;
  const el = (id) => document.getElementById(id);
  const recentEl = el('recent'), recentSep = el('recent-sep'), allToggle = el('all-toggle'), allArrow = el('all-arrow');
  const listEl = el('list'), searchEl = el('search'), rightEl = el('right'), footEl = el('foot');

  let state = null;
  let allApps = [];
  let showAll = false;
  let selected = -1;

  const RIGHT = [
    ['applications', 'Applications', '#f7b731'],
    ['documents', 'Documents', '#fed330'],
    ['downloads', 'Downloads', '#26de81'],
    ['home', 'Home', '#a5b1c2'],
    null,
    ['systemSettings', 'System Settings', '#778ca3'],
    ['settings', 'Startbar Settings', '#4b6584'],
    null,
    ['about', 'About Startbar', '#45aaf2']
  ];
  const POWER = [['sleep', 'Sleep', '#f7b731'], ['logout', 'Log Out', '#e8942a'], ['shutdown', 'Shut Down', '#d9412c']];

  function appItem(a) {
    const d = document.createElement('div');
    d.className = 'item';
    d.dataset.path = a.path;
    const img = document.createElement('img');
    img.src = a.icon || '';
    img.alt = '';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = a.name;
    d.append(img, label);
    d.addEventListener('click', () => api.launch(a.path));
    return d;
  }

  function renderRight() {
    rightEl.replaceChildren();
    const cols = state.settings.startMenu.rightColumn;
    for (const r of RIGHT) {
      if (!r) { const s = document.createElement('div'); s.className = 'sep'; rightEl.append(s); continue; }
      const [key, name, color] = r;
      if (key in cols && !cols[key]) continue;
      const d = document.createElement('div');
      d.className = 'item';
      const ico = document.createElement('span'); ico.className = 'ico'; ico.style.background = color;
      const label = document.createElement('span'); label.className = 'label'; label.textContent = name;
      d.append(ico, label);
      d.addEventListener('click', () => api.open(key));
      rightEl.append(d);
    }
    // drop a separator that ended up first, last or doubled
    [...rightEl.children].forEach((c, i, arr) => {
      if (c.className === 'sep' && (i === 0 || i === arr.length - 1 || (arr[i - 1] && arr[i - 1].className === 'sep'))) c.remove();
    });
  }

  function renderFoot() {
    footEl.replaceChildren();
    footEl.classList.toggle('hidden', !state.settings.startMenu.showPower);
    for (const [action, name, color] of POWER) {
      const s = document.createElement('span');
      s.className = 'pw';
      const ico = document.createElement('span'); ico.className = 'ico'; ico.style.background = color;
      s.append(ico, document.createTextNode(name));
      s.addEventListener('click', () => api.power(action));
      footEl.append(s);
    }
  }

  async function renderRecent() {
    const list = await api.recent();
    recentEl.replaceChildren(...list.map(appItem));
    recentSep.classList.toggle('hidden', list.length === 0);
  }

  function renderList() {
    const q = searchEl.value.trim().toLowerCase();
    const searching = q.length > 0;
    const visible = searching ? allApps.filter((a) => a.name.toLowerCase().includes(q)) : (showAll ? allApps : []);
    listEl.replaceChildren(...visible.map(appItem));
    if ((searching || showAll) && visible.length === 0) {
      const e = document.createElement('div'); e.className = 'empty'; e.textContent = searching ? 'Nothing matches.' : 'No apps found.';
      listEl.append(e);
    }
    const expanded = searching || showAll;
    recentEl.classList.toggle('hidden', expanded);
    recentSep.classList.toggle('hidden', expanded || recentEl.children.length === 0);
    allToggle.classList.toggle('hidden', searching);
    allArrow.textContent = showAll ? '▾' : '▸';
    selected = -1;
    highlight();
  }

  function highlight() {
    const items = [...listEl.querySelectorAll('.item')];
    items.forEach((it, i) => it.classList.toggle('selected', i === selected));
    if (selected >= 0 && items[selected]) items[selected].scrollIntoView({ block: 'nearest' });
  }

  allToggle.addEventListener('click', () => { showAll = !showAll; renderList(); });
  searchEl.addEventListener('input', renderList);
  document.addEventListener('keydown', (e) => {
    const items = [...listEl.querySelectorAll('.item')];
    if (e.key === 'Escape') { api.hideMenu(); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { selected = Math.min(items.length - 1, selected + 1); highlight(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { selected = Math.max(0, selected - 1); highlight(); e.preventDefault(); }
    else if (e.key === 'Enter') {
      const target = items[selected] || items[0];
      if (target) api.launch(target.dataset.path);
      e.preventDefault();
    }
  });

  async function apply(next) {
    state = next;
    window.applyTheme(state);
    el('user').textContent = state.user;
    renderRight();
    renderFoot();
  }

  async function onShown() {
    searchEl.value = '';
    showAll = false;
    allApps = await api.apps();
    await renderRecent();
    renderList();
    if (state && state.settings.startMenu.focusSearch) searchEl.focus();
  }

  api.getState().then(apply);
  api.onState(apply);
  api.onMenuShown(onShown);
})();
