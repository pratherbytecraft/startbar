// The list above a group button: one row per window of that app. Click a
// row to bring the window forward. Reports its height so the main process
// can size the window to fit.
(function () {
  const api = window.startbar;
  const list = document.getElementById('list');
  let current = null; // the group shown

  function row(w, icon) {
    const d = document.createElement('div');
    d.className = 'item' + (w.active ? ' current' : '') + (w.minimized ? ' dim' : '');
    d.dataset.id = w.id;
    d.dataset.title = w.title;
    const img = document.createElement('img');
    img.alt = '';
    if (icon) img.src = icon;
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = w.title;
    // A hint that the row can be dragged out onto the bar.
    const handle = document.createElement('span');
    handle.className = 'handle';
    handle.textContent = '⋮⋮';
    d.append(img, label, handle);
    d.addEventListener('click', () => {
      api.hideGroup();
      api.taskCommand({ cmd: 'activate', id: w.id });
    });
    d.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      api.taskMenu({ kind: 'window', pid: w.pid, id: w.id, inGroup: true });
    });
    return d;
  }

  // Dragging a row out onto the bar gives that window its own button.
  window.dragOut(list, { payload: (el) => ({ id: el.dataset.id, pid: current.pid, title: el.dataset.title, icon: current.icon }) });

  api.onGroupShow((group) => {
    current = group;
    list.replaceChildren(...group.windows.map((w) => row({ ...w, pid: group.pid }, group.icon)));
    window.playOpen(list);
    // Measured now, not on the next frame: a hidden window gets no frames.
    api.groupSize({ height: Math.ceil(list.getBoundingClientRect().height) });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') api.hideGroup();
  });

  api.getState().then(window.applyTheme);
  api.onState(window.applyTheme);
})();
