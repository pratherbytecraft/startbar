// The clock's text for a date and the clock settings. Shared by the bar and
// the settings preview.
(function () {
  function dateText(d, style) {
    switch (style) {
      case 'weekday': return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
      case 'numeric': return d.toLocaleDateString([], { year: '2-digit', month: 'numeric', day: 'numeric' });
      case 'dayFirst': return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      default: return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  }

  function clockText(d, c) {
    return {
      time: d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: c.seconds ? '2-digit' : undefined, hour12: c.hour12 }),
      date: dateText(d, c.dateStyle),
      full: d.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    };
  }

  window.clockText = clockText;
  window.dateText = dateText;
})();
