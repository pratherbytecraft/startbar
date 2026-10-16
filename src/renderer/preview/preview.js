// The pictures over a window button: one per window, with its title and an
// x to close it. Click a picture to bring that window forward. A window
// without a picture (minimized, on another Space, or no Screen Recording)
// shows its app's icon. Reports its size so the main process can fit the
// window to it.
(function () {
  const api = window.startbar;
  const pv = document.getElementById('pv');
  const MAX = 6; // more than this and the group list is the better fit

  function thumb(w, icon) {
    const d = document.createElement('div');
    d.className = 'thumb' + (w.active ? ' current' : '');
    d.dataset.id = w.id;
    const head = document.createElement('div');
    head.className = 't';
    const img = document.createElement('img');
    img.alt = '';
    if (icon) img.src = icon;
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = w.title;
    const x = document.createElement('span');
    x.className = 'x';
    x.textContent = '×';
    x.title = 'Close';
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      api.hidePreview();
      api.taskCommand({ cmd: 'close', id: w.id });
    });
    head.append(img, label, x);
    const shot = document.createElement('div');
    shot.className = 'shot';
    const app = document.createElement('img');
    app.className = 'app';
    app.alt = '';
    if (icon) app.src = icon;
    shot.append(app);
    if (w.minimized) {
      const note = document.createElement('small');
      note.textContent = 'Minimized';
      shot.append(note);
    }
    d.append(head, shot);
    d.addEventListener('click', () => {
      api.hidePreview();
      api.taskCommand({ cmd: 'activate', id: w.id });
    });
    return d;
  }

  api.onPreviewShow((p) => {
    pv.replaceChildren(...p.windows.slice(0, MAX).map((w) => thumb(w, p.icon)));
    window.playOpen(pv);
    // Measured now, not on the next frame: a hidden window gets no frames.
    const r = pv.getBoundingClientRect();
    api.previewSize({ width: Math.ceil(r.width), height: Math.ceil(r.height) });
  });

  api.onPreviewImage(({ id, image }) => {
    const d = [...pv.children].find((c) => c.dataset.id === id);
    if (!d) return;
    const shot = d.querySelector('.shot');
    const pic = document.createElement('img');
    pic.className = 'pic';
    pic.alt = '';
    pic.src = image;
    shot.replaceChildren(pic);
  });

  document.documentElement.addEventListener('mouseenter', () => api.previewHover(true));
  document.documentElement.addEventListener('mouseleave', () => api.previewHover(false));

  api.getState().then(window.applyTheme);
  api.onState(window.applyTheme);
})();
