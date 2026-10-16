// The window title tooltip above a bar button. It's its own small window so
// it isn't clipped by the bar. Lays out the text, then tells the main
// process how big the window needs to be.
(function () {
  const api = window.startbar;
  const tip = document.getElementById('tip');

  api.onTipText((text) => {
    tip.textContent = text;
    requestAnimationFrame(() => {
      const r = tip.getBoundingClientRect();
      api.tipSize({ width: Math.ceil(r.width), height: Math.ceil(r.height) });
    });
  });

  api.getState().then(window.applyTheme);
  api.onState(window.applyTheme);
})();
