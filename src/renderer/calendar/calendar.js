// The small calendar above the clock. Opens on this month with today
// marked. The arrows (or the left and right keys) change the month and the
// date at the bottom goes back to this one. Reports its height so the main
// process can size the window to fit.
(function () {
  const api = window.startbar;
  const box = document.getElementById('cal');
  const titleEl = document.getElementById('title');
  const namesEl = document.getElementById('names');
  const daysEl = document.getElementById('days');
  const todayEl = document.getElementById('today');
  let month = new Date(); // any day in the month shown

  // The first day of the week for the Mac's language, as getDay() counts (0 is Sunday).
  const firstDay = (() => {
    try {
      const locale = new Intl.Locale(navigator.language);
      const info = locale.getWeekInfo ? locale.getWeekInfo() : locale.weekInfo;
      return info ? info.firstDay % 7 : 0;
    } catch {
      return 0;
    }
  })();

  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  function cell(cls, text) {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
  }

  function render() {
    const today = new Date();
    const y = month.getFullYear();
    const m = month.getMonth();
    titleEl.textContent = new Date(y, m, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });

    // Weekday letters, from a week that starts on a Sunday (Oct 4, 2026).
    namesEl.replaceChildren(...Array.from({ length: 7 }, (_, i) => {
      const d = new Date(2026, 9, 4 + ((firstDay + i) % 7));
      return cell('name', d.toLocaleDateString([], { weekday: 'narrow' }));
    }));

    // Six weeks, so the window keeps one height from month to month.
    const lead = (new Date(y, m, 1).getDay() - firstDay + 7) % 7;
    daysEl.replaceChildren(...Array.from({ length: 42 }, (_, i) => {
      const d = new Date(y, m, 1 - lead + i);
      const cls = 'day' + (d.getMonth() !== m ? ' other' : '') + (sameDay(d, today) ? ' today' : '');
      const c = cell(cls, d.getDate());
      c.title = d.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      return c;
    }));

    todayEl.textContent = today.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    requestAnimationFrame(() => api.calendarSize({ height: Math.ceil(box.getBoundingClientRect().height) }));
  }

  function step(n) {
    month = new Date(month.getFullYear(), month.getMonth() + n, 1);
    render();
  }

  document.getElementById('prev').addEventListener('click', () => step(-1));
  document.getElementById('next').addEventListener('click', () => step(1));
  todayEl.addEventListener('click', () => {
    month = new Date();
    render();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') api.hideCalendar();
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
  });

  api.onCalendarShow(() => {
    month = new Date();
    render();
  });

  const apply = (state) => {
    window.applyTheme(state);
    render();
  };
  api.getState().then(apply);
  api.onState(window.applyTheme);
})();
