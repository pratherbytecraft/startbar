// The pictures over a window button: one per window, with its title and an
// x to close it. Click a picture to bring that window forward. A window
// without a picture (minimized, on another Space, or no Screen Recording)
// shows its app's icon. Reports its size so the main process can fit the
// window to it.
(function () {
  const api = window.startbar;
  const pv = document.getElementById('pv');
  const MAX = 6; // more than this and the group list is the better fit
  let current = null; // the preview shown

  function thumb(w, icon, p) {
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
    x.className = 'x no-drag';
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
    d.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      api.taskMenu({ kind: 'window', pid: p.pid, id: w.id, inGroup: !!p.group });
    });
    return d;
  }

  // Dragging a picture out onto the bar gives that window its own button.
  window.dragOut(pv, { payload: (el) => ({ id: el.dataset.id, pid: current.pid, title: el.querySelector('.label').textContent, icon: current.icon }) });

  api.onPreviewShow((p) => {
    current = p;
    pv.replaceChildren(...p.windows.slice(0, MAX).map((w) => thumb(w, p.icon, p)));
    window.playOpen(pv);
    // Measured now, not on the next frame: a hidden window gets no frames.
    const r = pv.getBoundingClientRect();
    api.previewSize({ width: Math.ceil(r.width), height: Math.ceil(r.height) });
  });

  // A minimized window's picture is the last one taken, faded, and keeps
  // its Minimized note.
  api.onPreviewImage(({ id, image, minimized }) => {
    const d = [...pv.children].find((c) => c.dataset.id === id);
    if (!d) return;
    const shot = d.querySelector('.shot');
    const pic = document.createElement('img');
    pic.className = 'pic';
    pic.alt = '';
    pic.src = image;
    const parts = [pic];
    if (minimized) {
      shot.classList.add('was');
      const note = document.createElement('small');
      note.textContent = 'Minimized';
      parts.push(note);
    }
    shot.replaceChildren(...parts);
  });

  document.documentElement.addEventListener('mouseenter', () => api.previewHover(true));
  document.documentElement.addEventListener('mouseleave', () => api.previewHover(false));

  api.getState().then(window.applyTheme);
  api.onState(window.applyTheme);
})();
