// Volume, Wi-Fi, battery and Bluetooth for the tray, from `startbar-helper
// status`, and where the Location, Bluetooth and Automation permissions
// stand. Keeps the latest reading, sends changes, and restarts the helper if
// it stops. Missing pieces (no Wi-Fi, no battery, Bluetooth not allowed)
// come through as null.
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const readline = require('readline');
const { statusHelperPath } = require('../../scripts/build-helper');

const events = new EventEmitter();
let child = null;
let stopping = false;
let restarts = 0;
let status = { volume: null, wifi: null, battery: null, bluetooth: null, access: {} };

function onLine(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.type !== 'status') return;
  status = { volume: msg.volume, wifi: msg.wifi, battery: msg.battery, bluetooth: msg.bluetooth, access: msg.access || {} };
  events.emit('change', status);
}

function start() {
  const helper = statusHelperPath();
  if (!helper) return;
  stopping = false;
  const startedAt = Date.now();
  child = spawn(helper, ['status'], { stdio: ['pipe', 'pipe', 'inherit'] });
  readline.createInterface({ input: child.stdout }).on('line', onLine);
  child.on('error', (err) => console.log(`Startbar: the tray helper did not start: ${err.message}`));
  child.on('exit', (code, signal) => {
    child = null;
    if (stopping) return;
    restarts = Date.now() - startedAt > 60000 ? 0 : restarts + 1;
    const delay = Math.min(30000, 1000 * 2 ** restarts);
    console.log(`Startbar: the tray helper stopped (${signal || code}), starting it again in ${delay / 1000}s.`);
    setTimeout(() => stopping || start(), delay);
  });
}

function stop() {
  stopping = true;
  if (child) child.kill();
}

// { cmd: 'setVolume', level: 0.4 }, { cmd: 'setMuted', muted: true },
// { cmd: 'setWifi', on: false }, { cmd: 'askLocation' } and the like. The new
// reading comes back as a change.
function send(command) {
  if (child) child.stdin.write(JSON.stringify(command) + '\n');
}

module.exports = {
  start,
  stop,
  send,
  get: () => status,
  onChange: (fn) => events.on('change', fn)
};
