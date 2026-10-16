// The panel above a tray icon: volume with a slider and mute, Wi-Fi with an
// on and off switch, or the battery's charge. Follows the live reading and
// reports its height so the main process can size the window to fit.
(function () {
  const api = window.startbar;
  const pop = document.getElementById('pop');
  let kind = null;
  let status = { volume: null, wifi: null, battery: null };
  let slider = null; // kept across redraws so a drag isn't interrupted
  let volumeParts = null; // { value, mute } of the volume panel on screen
  let frame = 0;

  function node(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function settingsLink(name, text) {
    const a = node('div', 'pop-link', text);
    a.addEventListener('click', () => api.traySettings(name));
    return a;
  }

  function toggle(on, click) {
    const t = node('div', 'pop-toggle' + (on ? ' on' : ''));
    t.addEventListener('click', click);
    return t;
  }

  function head(title, right) {
    const h = node('div', 'pop-head');
    h.append(node('span', 'pop-title', title));
    if (right) h.append(right);
    return h;
  }

  function volumePanel(v) {
    const mute = node('span', 'pop-icon');
    mute.innerHTML = window.trayIcons.volume(v);
    mute.title = v.muted ? 'Unmute' : 'Mute';
    mute.addEventListener('click', () => api.trayCommand({ cmd: 'setMuted', muted: !(status.volume && status.volume.muted) }));
    if (!slider) {
      slider = node('input', 'pop-slider');
      slider.type = 'range';
      slider.min = 0;
      slider.max = 100;
      slider.addEventListener('input', () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => api.trayCommand({ cmd: 'setVolume', level: slider.value / 100 }));
      });
      // Let go, the slider follows the reading again (the volume keys, say).
      slider.addEventListener('change', () => slider.blur());
    }
    if (document.activeElement !== slider) slider.value = Math.round((v.muted ? 0 : v.level) * 100);
    slider.disabled = !v.settable;
    const row = node('div', 'pop-row');
    row.append(mute, slider);
    const value = node('span', 'pop-value', v.muted ? 'Muted' : `${Math.round(v.level * 100)}%`);
    volumeParts = { value, mute };
    const parts = [head('Sound', value), row];
    if (!v.settable) parts.push(node('div', 'pop-note', "This output's volume is set on the device itself."));
    parts.push(settingsLink('volume', 'Sound Settings…'));
    return parts;
  }

  function wifiPanel(w) {
    const line = !w.on ? 'Off' : !w.connected ? 'Not connected' : `Connected, ${['', 'weak', 'fair', 'strong'][w.bars]} signal`;
    // The network's name comes with the Location permission only.
    const name = w.connected && w.name ? [node('div', 'pop-name', w.name)] : [];
    return [
      head('Wi-Fi', toggle(w.on, () => api.trayCommand({ cmd: 'setWifi', on: !w.on }))),
      ...name,
      node('div', 'pop-note', line),
      settingsLink('wifi', 'Wi-Fi Settings…')
    ];
  }

  function batteryPanel(b) {
    const { hours } = window.trayIcons;
    let line = 'On battery';
    if (b.charging) line = b.minutes > 0 ? `Charging, full in ${hours(b.minutes)}` : 'Charging';
    else if (b.plugged) line = b.percent >= 99 ? 'Fully charged' : 'Plugged in, not charging';
    else if (b.minutes > 0) line = `${hours(b.minutes)} left`;
    const bar = node('div', 'pop-meter');
    const fill = node('i');
    fill.style.width = Math.min(100, b.percent) + '%';
    bar.append(fill);
    return [head('Battery', node('span', 'pop-value', `${b.percent}%`)), bar, node('div', 'pop-note', line), settingsLink('battery', 'Battery Settings…')];
  }

  function render() {
    const s = kind && status[kind];
    if (!s) {
      // The thing went away while open (Wi-Fi hardware off the bus, for one).
      if (kind) api.hidePopover();
      return;
    }
    // While the slider is held, only the number and the icon follow along.
    if (kind === 'volume' && volumeParts && document.activeElement === slider && pop.contains(slider)) {
      volumeParts.value.textContent = s.muted ? 'Muted' : `${Math.round(s.level * 100)}%`;
      volumeParts.mute.innerHTML = window.trayIcons.volume(s);
      return;
    }
    const parts = kind === 'volume' ? volumePanel(s) : kind === 'wifi' ? wifiPanel(s) : batteryPanel(s);
    pop.replaceChildren(...parts);
    // Measured now, not on the next frame: a hidden window gets no frames.
    api.popoverSize({ height: Math.ceil(pop.getBoundingClientRect().height) });
  }

  api.onPopoverShow((k) => {
    kind = k;
    slider = null;
    volumeParts = null;
    render();
  });
  api.onStatus((s) => {
    status = s;
    render();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') api.hidePopover();
  });

  api.getStatus().then((s) => { status = s; });
  api.getState().then(window.applyTheme);
  api.onState(window.applyTheme);
})();
