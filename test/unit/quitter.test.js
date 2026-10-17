const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tempAppData } = require('../support/electron');
const timers = require('../support/timers');
const settings = require('../../src/main/settings');
const tasks = require('../../src/main/tasks');

// The window list comes from these instead of the helper.
let watcher = null;
let state = { accessibility: true, apps: [] };
let sent = [];
let reply = { ok: true, windows: false }; // the helper's answer to hasWindows
tasks.onChange = (fn) => { watcher = fn; };
tasks.get = () => state;
tasks.send = async (command) => {
  sent.push(command);
  return command.cmd === 'hasWindows' ? reply : { ok: true };
};

function app(pid, windows, extra = {}) {
  return { pid, name: `App ${pid}`, bundleId: `com.example.app${pid}`, path: `/Applications/App ${pid}.app`, hidden: false, windows: windows.map((id) => ({ id })), ...extra };
}

function show(apps, accessibility = true) {
  state = { accessibility, apps };
  watcher(state);
}

// A fresh quitter (it remembers each app's windows), settings and clock.
function start(t, quitApps = { on: true }) {
  tempAppData();
  settings.init();
  settings.update({ quitApps });
  sent = [];
  reply = { ok: true, windows: false };
  const clock = timers.install();
  t.after(() => clock.restore());
  delete require.cache[require.resolve('../../src/main/quitter')];
  require('../../src/main/quitter').start();
  return clock;
}

const quit = () => sent.filter((c) => c.cmd === 'quitApp').map((c) => c.pid);

test('an app quits a second after its last window closes', async (t) => {
  const clock = start(t);
  show([app(1, ['w1', 'w2'])]);
  show([app(1, ['w2'])]);
  await clock.advance(2000);
  assert.deepEqual(quit(), [], 'one window left');
  show([app(1, [])]);
  await clock.advance(999);
  assert.deepEqual(sent, []);
  await clock.advance(1);
  assert.deepEqual(sent, [{ cmd: 'hasWindows', pid: 1, ids: ['w2'] }, { cmd: 'quitApp', pid: 1 }]);
});

test('a window that opens during the wait keeps the app', async (t) => {
  const clock = start(t);
  show([app(1, ['w1'])]);
  show([app(1, [])]);
  await clock.advance(500);
  show([app(1, ['w2'])]);
  await clock.advance(2000);
  assert.deepEqual(sent, []);
});

test('an app that never had a window is left running', async (t) => {
  const clock = start(t);
  show([app(1, [])]);
  show([app(1, [])]);
  await clock.advance(2000);
  assert.deepEqual(sent, []);
});

test('a hidden app is left running', async (t) => {
  const clock = start(t);
  show([app(1, ['w1'])]);
  show([app(1, [], { hidden: true })]);
  await clock.advance(2000);
  assert.deepEqual(sent, []);
});

test('an app hidden during the wait is left running', async (t) => {
  const clock = start(t);
  show([app(1, ['w1'])]);
  show([app(1, [])]);
  state = { accessibility: true, apps: [app(1, [], { hidden: true })] };
  await clock.advance(2000);
  assert.deepEqual(quit(), []);
});

test('apps in the Leave these apps running list are left running', async (t) => {
  const clock = start(t, { on: true, keepRunning: ['/Applications/App 1.app'] });
  show([app(1, ['w1']), app(2, ['w2'])]);
  show([app(1, []), app(2, [])]);
  await clock.advance(2000);
  assert.deepEqual(quit(), [2]);
});

test('Finder, Filedrawer and Startbar are always left running', async (t) => {
  const clock = start(t);
  const ids = ['com.apple.finder', 'com.pratherbytecraft.filedrawer', 'com.pratherbytecraft.startbar'];
  show(ids.map((bundleId, i) => app(i + 1, [`w${i}`], { bundleId })));
  show(ids.map((bundleId, i) => app(i + 1, [], { bundleId })));
  await clock.advance(2000);
  assert.deepEqual(sent, []);
});

test('nothing quits while the switch is off', async (t) => {
  const clock = start(t, { on: false });
  show([app(1, ['w1'])]);
  show([app(1, [])]);
  await clock.advance(2000);
  assert.deepEqual(sent, []);
});

test('turning the switch off during the wait stops the quit', async (t) => {
  const clock = start(t);
  show([app(1, ['w1'])]);
  show([app(1, [])]);
  settings.update({ quitApps: { on: false } });
  await clock.advance(2000);
  assert.deepEqual(sent, []);
});

test('nothing quits without Accessibility, when every window list is empty', async (t) => {
  const clock = start(t);
  show([app(1, ['w1'])]);
  show([app(1, [])], false);
  await clock.advance(2000);
  assert.deepEqual(sent, []);
});

test('a window the helper still finds, on another Space say, keeps the app', async (t) => {
  const clock = start(t);
  reply = { ok: true, windows: true };
  show([app(1, ['w1'])]);
  show([app(1, [])]);
  await clock.advance(2000);
  assert.deepEqual(sent, [{ cmd: 'hasWindows', pid: 1, ids: ['w1'] }]);
});

test('no answer from the helper keeps the app', async (t) => {
  const clock = start(t);
  reply = { ok: false, error: 'no answer from the helper' };
  show([app(1, ['w1'])]);
  show([app(1, [])]);
  await clock.advance(2000);
  assert.deepEqual(quit(), []);
});

test('an app that quit on its own during the wait is not asked again', async (t) => {
  const clock = start(t);
  show([app(1, ['w1'])]);
  show([app(1, [])]);
  show([]);
  await clock.advance(2000);
  assert.deepEqual(sent, []);
});

test('each app waits on its own', async (t) => {
  const clock = start(t);
  show([app(1, ['w1']), app(2, ['w2'])]);
  show([app(1, []), app(2, ['w2'])]);
  await clock.advance(600);
  show([app(1, []), app(2, [])]);
  await clock.advance(400);
  assert.deepEqual(quit(), [1]);
  await clock.advance(600);
  assert.deepEqual(quit(), [1, 2]);
});
