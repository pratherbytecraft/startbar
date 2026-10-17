// The window title tooltip above a bar button. It's its own small window so
// it isn't clipped by the bar. Lays out the text, then tells the main
// process how big the window needs to be. With an icon it's the ghost under
// the cursor while a window is dragged out of its group onto the bar.
(function () {
  const api = window.startbar;
  const tip = document.getElementById('tip');

  api.onTipText((payload) => {
    const p = typeof payload === 'string' ? { text: payload } : payload;
    tip.classList.toggle('ghost', !!p.icon);
    tip.replaceChildren();
    if (p.icon) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = p.icon;
      tip.append(img);
    }
    tip.append(document.createTextNode(p.text));
    // Measured now, not on the next frame: a hidden window gets no frames.
    const r = tip.getBoundingClientRect();
    api.tipSize({ width: Math.ceil(r.width), height: Math.ceil(r.height) });
  });

  api.getState().then(window.applyTheme);
  api.onState(window.applyTheme);
})();
