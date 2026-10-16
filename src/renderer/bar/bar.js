(function () {
  let state = null;
  const start = document.getElementById('start');
  const clock = document.getElementById('clock');
  const timeEl = document.getElementById('time');
  const dateEl = document.getElementById('date');

  start.addEventListener('click', () => window.startbar.clickStart());
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

  function apply(next) {
    state = next;
    window.applyTheme(state);
    tick();
  }

  window.startbar.getState().then(apply);
  window.startbar.onState(apply);
  setInterval(tick, 1000);
})();
