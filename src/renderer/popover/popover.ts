// The panel above a tray icon: volume with a slider and mute, Wi-Fi with an
// on and off switch, the battery's charge, or Bluetooth with its devices. Follows the live reading and
// reports its height so the main process can size the window to fit.
(function () {
  const api = window.startbar;
  const pop = document.getElementById('pop')!; // in index.html
  let kind: PopoverKind | null = null;
  let status: Pick<Status, PopoverKind> = { volume: null, wifi: null, battery: null, bluetooth: null };
  let slider: HTMLInputElement | null = null; // kept across redraws so a drag isn't interrupted
  let volumeParts: { value: HTMLElement; mute: HTMLElement } | null = null; // { value, mute } of the volume panel on screen
  let frame = 0;

  function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string | null, text?: string | null) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function settingsLink(name: PopoverKind, text: string) {
    const a = node('div', 'pop-link', text);
    a.addEventListener('click', () => api.traySettings(name));
    return a;
  }

  function toggle(on: boolean, click: () => void) {
    const t = node('div', 'pop-toggle' + (on ? ' on' : ''));
    t.addEventListener('click', click);
    return t;
  }

  function head(title: string, right?: HTMLElement) {
    const h = node('div', 'pop-head');
    h.append(node('span', 'pop-title', title));
    if (right) h.append(right);
    return h;
  }

  function volumePanel(v: Volume) {
    const mute = node('span', 'pop-icon');
    mute.innerHTML = window.trayIcons.volume(v);
    mute.title = v.muted ? 'Unmute' : 'Mute';
    mute.addEventListener('click', () => api.trayCommand({ cmd: 'setMuted', muted: !(status.volume && status.volume.muted) }));
    if (!slider) {
      slider = node('input', 'pop-slider');
      slider.type = 'range';
      // The DOM turns numbers into strings, and / turns the value back.
      slider.min = 0 as unknown as string;
      slider.max = 100 as unknown as string;
      slider.addEventListener('input', () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => api.trayCommand({ cmd: 'setVolume', level: (slider!.value as unknown as number) / 100 }));
      });
      // Let go, the slider follows the reading again (the volume keys, say).
      slider.addEventListener('change', () => slider!.blur());
    }
    if (document.activeElement !== slider) slider.value = Math.round((v.muted ? 0 : v.level) * 100) as unknown as string;
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

  function wifiPanel(w: Wifi) {
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

  function batteryPanel(b: Battery) {
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

  function deviceRow(d: BluetoothDevice) {
    const r = node('div', 'pop-dev');
    r.title = d.connected ? 'Disconnect' : 'Connect';
    const icon = node('span', 'pop-dev-icon');
    icon.innerHTML = window.trayIcons.device(d.kind);
    const name = node('div', 'pop-dev-name', d.name);
    name.append(node('small', null, d.connected ? 'Connected' : 'Not connected'));
    r.append(icon, name);
    if (d.battery != null) r.append(node('span', 'pop-value', `${d.battery}%`));
    r.addEventListener('click', () => api.trayCommand({ cmd: 'setConnected', address: d.address, on: !d.connected }));
    return r;
  }

  function bluetoothPanel(b: Bluetooth) {
    const parts = [head('Bluetooth', toggle(b.on, () => api.trayCommand({ cmd: 'setBluetooth', on: !b.on })))];
    if (!b.on) parts.push(node('div', 'pop-note', 'Off'));
    else if (b.devices.length === 0) parts.push(node('div', 'pop-note', 'No devices paired.'));
    else {
      // Connected first, then the rest in the order macOS keeps them.
      const devices = [...b.devices].sort((x, y) => (y.connected as unknown as number) - (x.connected as unknown as number)).slice(0, 8); // true counts as 1
      const list = node('div', 'pop-devices');
      list.append(...devices.map(deviceRow));
      parts.push(list);
    }
    parts.push(settingsLink('bluetooth', 'Bluetooth Settings…'));
    return parts;
  }

  function render() {
    // Each panel reads only its own kind's fields.
    const s = (kind && status[kind]) as TrayReading | null;
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
    const panels = { volume: volumePanel, wifi: wifiPanel, battery: batteryPanel, bluetooth: bluetoothPanel };
    const parts = panels[kind!](s); // s is only set with a kind
    pop.replaceChildren(...parts);
    // Measured now, not on the next frame: a hidden window gets no frames.
    api.popoverSize({ height: Math.ceil(pop.getBoundingClientRect().height) });
  }

  api.onPopoverShow((k) => {
    kind = k;
    slider = null;
    volumeParts = null;
    render();
    window.playOpen(document.getElementById('pop'));
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
