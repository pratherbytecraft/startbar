// Quits an app when its last window closes, the way apps work on Windows.
// Off unless turned on in General. Only an app that had a window and closed
// it: after a short wait, and once the helper finds no window of it on any
// Space, it's asked to quit like Command Q, so unsaved work still asks first.
// Hidden apps, the apps in the Leave these apps running list and the ones
// below are left alone. Apps without a Dock icon never get here, the
// helper's list has only regular apps. Nothing quits while the screen is
// locked or just after, and nothing quits when more than one app loses its
// last window in the same list: the window list can come back empty for
// every app at once behind the lock screen, and that isn't a person closing
// windows.
const { execFile } = require('child_process');
const tasks = require('./tasks');
const settings = require('./settings');

const ALWAYS = new Set(['com.apple.finder', 'com.pratherbytecraft.filedrawer', 'com.pratherbytecraft.startbar']);
const WAIT = 1000;
const AFTER_UNLOCK = 5000; // windows take a moment to show again

let lockedUntil = 0; // Infinity while the screen is locked

const last = new Map(); // pid -> the window ids in the previous list
const timers = new Map(); // pid -> the wait before quitting it

function leftRunning(app) {
  return ALWAYS.has(app.bundleId) || settings.get().quitApps.keepRunning.includes(app.path);
}

function cancel(pid) {
  clearTimeout(timers.get(pid));
  timers.delete(pid);
}

function locked() {
  return Date.now() < lockedUntil;
}

// From the main process, when the screen locks and unlocks.
function setLocked(on) {
  lockedUntil = on ? Infinity : Date.now() + AFTER_UNLOCK;
  for (const pid of [...timers.keys()]) cancel(pid);
}

function watch(state) {
  const on = settings.get().quitApps.on && state.accessibility === true && !locked();
  const alive = new Set();
  const closed = []; // apps that lost their last window in this list
  for (const app of state.apps) {
    alive.add(app.pid);
    const ids = app.windows.map((w) => w.id);
    const before = last.get(app.pid) || [];
    last.set(app.pid, ids);
    if (ids.length || !on) {
      cancel(app.pid);
      continue;
    }
    if (before.length && !timers.has(app.pid) && !app.hidden && !leftRunning(app)) {
      closed.push({ pid: app.pid, ids: before });
    }
  }
  if (closed.length === 1) {
    const { pid, ids } = closed[0];
    timers.set(pid, setTimeout(() => quit(pid, ids), WAIT));
  }
  for (const pid of last.keys()) {
    if (alive.has(pid)) continue;
    last.delete(pid);
    cancel(pid);
  }
}

async function quit(pid, ids) {
  timers.delete(pid);
  const state = tasks.get();
  const app = state.apps.find((a) => a.pid === pid);
  if (!app || app.windows.length || app.hidden || leftRunning(app)) return;
  if (!settings.get().quitApps.on || state.accessibility !== true || locked()) return;
  const reply = await tasks.send({ cmd: 'hasWindows', pid, ids });
  if (!reply.ok || reply.windows || locked()) return;
  console.log(`Startbar: ${app.name} closed its last window, asking it to quit.`);
  tasks.send({ cmd: 'quitApp', pid });
}

// Whether Swift Quit, which does the same thing, is running. Looked up when
// the settings window opens or comes forward; onChange runs when it differs.
let swiftQuit = false;

function checkSwiftQuit(onChange) {
  execFile('pgrep', ['-x', 'Swift Quit'], (err) => {
    if (swiftQuit === !err) return;
    swiftQuit = !err;
    onChange();
  });
}

function start() {
  tasks.onChange(watch);
}

module.exports = { start, setLocked, checkSwiftQuit, swiftQuitRunning: () => swiftQuit, ALWAYS };
