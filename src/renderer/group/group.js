// The list above a group button: one row per window of that app. Click a
// row to bring the window forward. Reports its height so the main process
// can size the window to fit.
(function () {
  const api = window.startbar;
  const list = document.getElementById('list');

  function row(w, icon) {
    const d = document.createElement('div');
    d.className = 'item' + (w.active ? ' current' : '') + (w.minimized ? ' dim' : '');
    const img = document.createElement('img');
    img.alt = '';
    if (icon) img.src = icon;
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = w.title;
    d.append(img, label);
    d.addEventListener('click', () => {
      api.hideGroup();
      api.taskCommand({ cmd: 'activate', id: w.id });
    });
    d.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      api.taskMenu({ kind: 'window', pid: w.pid, id: w.id });
    });
    return d;
  }

  api.onGroupShow((group) => {
    list.replaceChildren(...group.windows.map((w) => row({ ...w, pid: group.pid }, group.icon)));
    requestAnimationFrame(() => api.groupSize({ height: Math.ceil(list.getBoundingClientRect().height) }));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') api.hideGroup();
  });

  api.getState().then(window.applyTheme);
  api.onState(window.applyTheme);
})();
