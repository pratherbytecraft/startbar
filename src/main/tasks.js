// The running apps and their windows, from `startbar-helper windows`.
// Keeps the latest list, sends window commands, and restarts the helper if
// it stops. The bar draws its buttons from this list.
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const readline = require('readline');
const { helperPath } = require('../../scripts/build-helper');

const events = new EventEmitter();
const pending = new Map(); // seq -> resolve
let child = null;
let stopping = false;
let restarts = 0;
let relaunch = false;
let seq = 0;
let state = { accessibility: null, apps: [] };
let keepOff = { cmd: 'keepOff' }; // resent to every new helper

function update(patch) {
  state = { ...state, ...patch };
  events.emit('change', state);
}

function onLine(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.type === 'permission') {
    const wasOff = state.accessibility === false;
    if (msg.accessibility !== state.accessibility) {
      console.log(`Startbar: Accessibility permission ${msg.accessibility ? 'on' : 'off'}.`);
    }
    update({ accessibility: !!msg.accessibility });
    // Granted while running. A fresh helper starts with the permission in
    // place instead of relying on a process that began without it.
    if (wasOff && msg.accessibility) restart();
  } else if (msg.type === 'state') {
    update({ apps: msg.apps });
  } else if (msg.type === 'reply') {
    const resolve = pending.get(msg.seq);
    if (resolve) {
      pending.delete(msg.seq);
      resolve(msg);
    }
  }
}

function start() {
  const helper = helperPath();
  if (!helper) {
    console.log('Startbar: the helper is missing, so the bar has no window buttons.');
    return;
  }
  stopping = false;
  const startedAt = Date.now();
  child = spawn(helper, ['windows'], { stdio: ['pipe', 'pipe', 'inherit'] });
  readline.createInterface({ input: child.stdout }).on('line', onLine);
  child.stdin.write(JSON.stringify(keepOff) + '\n');
  child.on('error', (err) => console.log(`Startbar: the window helper did not start: ${err.message}`));
  child.on('exit', (code, signal) => {
    child = null;
    for (const resolve of pending.values()) resolve({ ok: false, error: 'the helper stopped' });
    pending.clear();
    if (stopping) return;
    if (relaunch) {
      relaunch = false;
      restarts = 0;
      return start();
    }
    // Back off if it keeps dying, up to half a minute between tries.
    restarts = Date.now() - startedAt > 60000 ? 0 : restarts + 1;
    const delay = Math.min(30000, 1000 * 2 ** restarts);
    console.log(`Startbar: the window helper stopped (${signal || code}), starting it again in ${delay / 1000}s.`);
    setTimeout(() => stopping || start(), delay);
  });
}

function restart() {
  if (!child) return;
  relaunch = true;
  child.kill();
}

function stop() {
  stopping = true;
  if (child) child.kill();
}

// Sends one command, for example { cmd: 'activate', id: 'w123' } or
// { cmd: 'quitApp', pid: 501 }. Resolves to the helper's reply.
function send(command) {
  return new Promise((resolve) => {
    if (!child) return resolve({ ok: false, error: 'the helper is not running' });
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, error: 'no answer from the helper' });
    }, 5000);
    pending.set(id, (reply) => {
      clearTimeout(timer);
      resolve(reply);
    });
    child.stdin.write(JSON.stringify({ ...command, seq: id }) + '\n');
  });
}

// Where the bar is, so the helper can move windows up off it. Pass null to
// stop, for example while the bar is hidden or the setting is off.
function setKeepOff(area) {
  keepOff = { cmd: 'keepOff', ...(area || {}) };
  if (child) send(keepOff);
}

module.exports = {
  start,
  setKeepOff,
  stop,
  restart,
  send,
  get: () => state,
  onChange: (fn) => events.on('change', fn)
};
