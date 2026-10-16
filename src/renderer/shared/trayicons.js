// The tray's volume, Wi-Fi, battery and Bluetooth icons and their tooltips,
// drawn from a reading of `startbar-helper status`. Shared by the bar, the
// settings preview and the Bluetooth panel's device list.
(function () {
  const svg = (body) => `<svg viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`;

  function volume(v) {
    const speaker = '<path d="M2 6h3l4-3v10l-4-3H2z" stroke="none"/>';
    if (v.muted || v.level === 0) return svg(speaker + '<path d="M11 6l4 4M15 6l-4 4" fill="none" stroke-width="1.3" stroke-linecap="round"/>');
    const small = '<path d="M11 5.5a4 4 0 010 5" fill="none" stroke-width="1.3" stroke-linecap="round"/>';
    const big = '<path d="M12.5 3.5a7 7 0 010 9" fill="none" stroke-width="1.3" stroke-linecap="round"/>';
    return svg(speaker + small + (v.level > 0.5 ? big : ''));
  }

  function wifi(w) {
    const arcs = [
      'M5.5 11a3 3 0 015 0',
      'M3.5 8.5a6 6 0 019 0',
      'M1.5 6a9 9 0 0113 0'
    ];
    const lit = w.connected ? w.bars : 0;
    const body = arcs.map((d, i) => `<path d="${d}" fill="none" stroke-width="1.4" stroke-linecap="round" opacity="${i < lit ? 1 : 0.3}"/>`).join('')
      + `<circle cx="8" cy="13.2" r="1.2" stroke="none" opacity="${w.connected ? 1 : 0.3}"/>`;
    return svg(body + (w.on ? '' : '<path d="M2.5 2.5l11 11" fill="none" stroke-width="1.4" stroke-linecap="round"/>'));
  }

  function battery(b) {
    const width = Math.max(1, Math.round(9 * Math.min(100, b.percent) / 100));
    const low = b.percent <= 20 && !b.plugged;
    const fill = `<rect x="3" y="5.5" width="${width}" height="5" rx=".6" stroke="none"${low ? ' fill="#ff453a"' : ''}/>`;
    const bolt = b.charging ? '<path d="M8.6 3.6 5.8 8.4h2.3l-.8 4 2.9-4.9H7.9z" stroke="none" fill="currentColor" class="bolt"/>' : '';
    return svg('<rect x="1.5" y="4" width="12" height="8" rx="1.8" fill="none" stroke-width="1"/>'
      + '<path d="M14.5 6.5v3" fill="none" stroke-width="1.4" stroke-linecap="round"/>' + (b.charging ? bolt : fill));
  }

  const RUNE = 'M4.5 5l7 6-3.5 3V2l3.5 3-7 6';

  function bluetooth(b) {
    return svg(`<path d="${RUNE}" fill="none" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" opacity="${b.on ? 1 : 0.4}"/>`);
  }

  const DEVICES = {
    audio: '<path d="M3 10V8.5a5 5 0 0110 0V10"/><rect x="2.5" y="9.5" width="3" height="4.5" rx="1"/><rect x="10.5" y="9.5" width="3" height="4.5" rx="1"/>',
    keyboard: '<rect x="1.5" y="4.5" width="13" height="7" rx="1.2"/><path d="M4 7h.01M6.5 7h.01M9 7h.01M11.5 7h.01M5 9.5h6"/>',
    mouse: '<rect x="4.5" y="1.5" width="7" height="13" rx="3.5"/><path d="M8 4v2.5"/>',
    phone: '<rect x="4.5" y="1.5" width="7" height="13" rx="1.5"/><path d="M7 12.5h2"/>',
    computer: '<rect x="2" y="3" width="12" height="8" rx="1"/><path d="M1 13.5h14"/>',
    other: `<path d="${RUNE}"/>`
  };

  function device(kind) {
    return svg(`<g fill="none" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${DEVICES[kind] || DEVICES.other}</g>`);
  }

  function hours(minutes) {
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
  }

  function tip(kind, s) {
    if (kind === 'volume') return s.muted ? 'Volume: muted' : `Volume: ${Math.round(s.level * 100)}%`;
    if (kind === 'bluetooth') {
      if (!s.on) return 'Bluetooth: off';
      const connected = s.devices.filter((d) => d.connected);
      if (connected.length === 0) return 'Bluetooth: on, nothing connected';
      return connected.length === 1 ? `Bluetooth: ${connected[0].name} connected` : `Bluetooth: ${connected.length} devices connected`;
    }
    if (kind === 'wifi') {
      if (!s.on) return 'Wi-Fi: off';
      if (!s.connected) return 'Wi-Fi: not connected';
      return `Wi-Fi: ${s.name || 'connected'}, ${['', 'weak', 'fair', 'strong'][s.bars]} signal`;
    }
    let text = `Battery: ${s.percent}%`;
    if (s.charging) text += s.minutes > 0 ? `, charging, full in ${hours(s.minutes)}` : ', charging';
    else if (s.plugged) text += ', plugged in';
    else if (s.minutes > 0) text += `, ${hours(s.minutes)} left`;
    return text;
  }

  // The kinds to draw, in order, for these settings and this reading.
  function shown(settings, status) {
    return ['bluetooth', 'volume', 'wifi', 'battery'].filter((k) => settings.tray[k] && status && status[k]);
  }

  window.trayIcons = { volume, wifi, battery, bluetooth, device, tip, shown, hours };
})();
