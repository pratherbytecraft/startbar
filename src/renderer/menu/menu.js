(function () {
  const api = window.startbar;
  const el = (id) => document.getElementById(id);
  const recentEl = el('recent'), recentHead = el('recent-head'), recentSep = el('recent-sep'), allToggle = el('all-toggle'), allArrow = el('all-arrow');
  const listEl = el('list'), searchEl = el('search'), rightEl = el('right'), footEl = el('foot');

  let state = null;
  let allApps = [];
  let showAll = false;
  let selected = -1;
  let files = []; // home folder files for the current search
  let filesPending = false;
  let fileSeq = 0;
  let fileTimer = null;

  const RIGHT = [
    ['applications', 'Applications', '#f7b731'],
    ['documents', 'Documents', '#fed330'],
    ['downloads', 'Downloads', '#26de81'],
    ['home', 'Home', '#a5b1c2'],
    null,
    ['systemSettings', 'System Settings', '#778ca3'],
    ['settings', 'Startbar Settings', '#4b6584'],
    null,
    ['update', 'Update Available', '#26de81'],
    ['about', 'About Startbar', '#45aaf2']
  ];
  const POWER = [['sleep', 'Sleep', '#f7b731'], ['logout', 'Log Out', '#e8942a'], ['shutdown', 'Shut Down', '#d9412c']];
  // White marks drawn on each power button's colored badge: a moon, a door
  // with an arrow, the power symbol.
  const POWER_MARKS = {
    sleep: '<path d="M10.2 3.2a5 5 0 1 0 2.6 8.4 4.2 4.2 0 0 1-2.6-8.4z" fill="#fff"/>',
    logout: '<path d="M7 3.5H4v9h3" fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/><path d="M7.5 8h5.5M10.8 5.6 13.2 8l-2.4 2.4" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    shutdown: '<path d="M8 2.6v5" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/><path d="M4.9 4.6a4.6 4.6 0 1 0 6.2 0" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/>'
  };

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
    d.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      api.appMenu(a.path);
    });
    return d;
  }

  function fileItem(f) {
    const d = document.createElement('div');
    d.className = 'item file';
    const img = document.createElement('img');
    img.src = f.icon || '';
    img.alt = '';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = f.name;
    const where = document.createElement('span');
    where.className = 'where';
    where.textContent = f.where;
    d.append(img, label, where);
    d.title = f.path;
    d.addEventListener('click', () => api.openFile(f.path));
    return d;
  }

  // The system's icons for the right column, by key. A colored square until
  // they arrive.
  let placeIcons = {};

  function placeIcon(key, color) {
    if (placeIcons[key]) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = placeIcons[key];
      return img;
    }
    const ico = document.createElement('span'); ico.className = 'ico'; ico.style.background = color;
    return ico;
  }

  function folderItem(folder) {
    const d = document.createElement('div');
    d.className = 'item';
    const ico = placeIcon('folder', '#54a0ff');
    const label = document.createElement('span'); label.className = 'label'; label.textContent = folder.split('/').pop() || folder;
    d.append(ico, label);
    d.title = folder;
    d.addEventListener('click', () => api.openFolder(folder));
    return d;
  }

  function renderRight() {
    rightEl.replaceChildren();
    const cols = state.settings.startMenu.rightColumn;
    for (const r of RIGHT) {
      if (!r) { const s = document.createElement('div'); s.className = 'sep'; rightEl.append(s); continue; }
      const [key, name, color] = r;
      if (key in cols && !cols[key]) continue;
      // Shown once a check finds a newer version. Opens the About page.
      if (key === 'update' && !(state.update && state.update.state === 'available')) continue;
      const d = document.createElement('div');
      d.className = 'item';
      const ico = placeIcon(key, color);
      const label = document.createElement('span'); label.className = 'label'; label.textContent = name;
      d.append(ico, label);
      d.addEventListener('click', () => api.open(key));
      rightEl.append(d);
    }
    // Added folders go after the built in ones, before the first separator.
    const firstSep = rightEl.querySelector('.sep');
    for (const folder of state.settings.startMenu.folders) rightEl.insertBefore(folderItem(folder), firstSep);
    // drop a separator that ended up first, last or doubled
    [...rightEl.children].forEach((c, i, arr) => {
      if (c.className === 'sep' && (i === 0 || i === arr.length - 1 || (arr[i - 1] && arr[i - 1].className === 'sep'))) c.remove();
    });
  }

  // Every theme gets the three buttons. Themes that show Shut Down alone
  // also show the arrow, which opens the other two above it.
  function renderFoot() {
    footEl.replaceChildren();
    footEl.classList.toggle('hidden', !state.settings.startMenu.showPower);
    const pop = document.createElement('div');
    pop.className = 'pw-pop';
    for (const [action, name, color] of POWER) {
      const s = document.createElement('span');
      s.className = 'pw ' + action;
      const ico = document.createElement('span'); ico.className = 'ico'; ico.style.background = color;
      ico.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${POWER_MARKS[action]}</svg>`;
      s.append(ico, document.createTextNode(name));
      s.addEventListener('click', () => api.power(action));
      footEl.append(s);
      if (action === 'shutdown') continue;
      const p = document.createElement('div');
      p.textContent = name;
      p.addEventListener('click', () => {
        pop.classList.remove('open');
        api.power(action);
      });
      pop.append(p);
    }
    const more = document.createElement('span');
    more.className = 'pw-more';
    more.textContent = '\u25B8';
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      pop.classList.toggle('open');
    });
    footEl.append(more, pop);
  }
  document.addEventListener('click', () => document.querySelector('.pw-pop.open')?.classList.remove('open'));
  window.addEventListener('blur', () => document.querySelector('.pw-pop.open')?.classList.remove('open'));

  async function renderRecent() {
    const list = await api.recent();
    recentEl.replaceChildren(...list.map(appItem));
    recentHead.classList.toggle('hidden', list.length === 0);
    recentSep.classList.toggle('hidden', list.length === 0);
  }

  // Apps first, then files when the setting asks for them. keep holds the
  // keyboard selection when files arrive after the apps.
  function renderList(keep) {
    const q = searchEl.value.trim().toLowerCase();
    const searching = q.length > 0;
    const visible = searching ? allApps.filter((a) => a.name.toLowerCase().includes(q)) : (showAll ? allApps : []);
    listEl.replaceChildren(...visible.map(appItem));
    if (searching && files.length) {
      const head = document.createElement('div');
      head.className = 'list-head';
      head.textContent = 'Files';
      listEl.append(head, ...files.map(fileItem));
    } else if (searching && filesPending) {
      // Spotlight can take a few seconds, the first search after launch most of all.
      const head = document.createElement('div');
      head.className = 'list-head';
      head.textContent = 'Searching files…';
      listEl.append(head);
    }
    if ((searching || showAll) && visible.length === 0 && files.length === 0 && !filesPending) {
      const e = document.createElement('div'); e.className = 'empty'; e.textContent = searching ? 'Nothing matches.' : 'No apps found.';
      listEl.append(e);
    }
    const expanded = searching || showAll;
    recentEl.classList.toggle('hidden', expanded);
    recentHead.classList.toggle('hidden', expanded || recentEl.children.length === 0);
    recentSep.classList.toggle('hidden', expanded || recentEl.children.length === 0);
    allToggle.classList.toggle('hidden', searching);
    allArrow.classList.toggle('open', showAll);
    if (!keep) selected = -1;
    highlight();
  }

  // Spotlight takes about a second, so it waits for a pause in the typing.
  function queueFiles() {
    clearTimeout(fileTimer);
    const seq = ++fileSeq;
    const q = searchEl.value.trim();
    files = [];
    filesPending = !!state && state.settings.startMenu.search === 'files' && q.length >= 2;
    if (!filesPending) return;
    fileTimer = setTimeout(async () => {
      const found = await api.searchFiles(q);
      if (seq !== fileSeq) return;
      files = found;
      filesPending = false;
      renderList(true);
    }, 200);
  }

  function highlight() {
    const items = [...listEl.querySelectorAll('.item')];
    items.forEach((it, i) => it.classList.toggle('selected', i === selected));
    if (selected >= 0 && items[selected]) items[selected].scrollIntoView({ block: 'nearest' });
  }

  // All Applications slides its list in, and back out to the recent apps.
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let leaving = null;
  allToggle.addEventListener('click', () => {
    if (leaving) return;
    if (!showAll) {
      showAll = true;
      renderList();
      window.playRows(listEl);
      return;
    }
    listEl.classList.add('leaving');
    leaving = setTimeout(() => {
      leaving = null;
      listEl.classList.remove('leaving');
      showAll = false;
      renderList();
      window.playRows(recentEl);
    }, reducedMotion.matches ? 0 : 110);
  });
  searchEl.addEventListener('input', () => {
    queueFiles();
    renderList();
  });
  document.addEventListener('keydown', (e) => {
    const items = [...listEl.querySelectorAll('.item')];
    if (e.key === 'Escape') { api.hideMenu(); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { selected = Math.min(items.length - 1, selected + 1); highlight(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { selected = Math.max(0, selected - 1); highlight(); e.preventDefault(); }
    else if (e.key === 'Enter') {
      const target = items[selected] || items[0];
      if (target) target.click();
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
    window.playOpen(document.querySelector('.menu'));
    searchEl.value = '';
    showAll = false;
    queueFiles();
    allApps = await api.apps();
    await renderRecent();
    renderList();
    if (state && state.settings.startMenu.focusSearch) searchEl.focus();
  }

  api.getState().then(apply);
  // The account picture over the avatar's gradient, when there is one.
  api.userPicture().then((url) => {
    if (!url) return;
    const img = document.createElement('img');
    img.alt = '';
    img.src = url;
    document.querySelector('.avatar').append(img);
  });
  api.placeIcons().then((found) => {
    placeIcons = found || {};
    if (state) renderRight();
  });
  api.onState(apply);
  api.onMenuShown(onShown);
})();
