import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { tempAppData } from '../support/electron';
import * as timers from '../support/timers';
import * as settings from '../../src/main/settings';
import type { HelperCommand } from '../../src/main/tasks';
import type { AppCommand, HelperReply, Settings, TaskApp, Tasks } from '../../src/shared/types';

type QuitterModule = typeof import('../../src/main/quitter');

// The quitter reaches the window list through tasks, whose exports are
// read only now that it's TypeScript. A writable copy takes its place in
// the module cache, so the quitter loads the copy and its stand-ins below.
type TasksModule = typeof import('../../src/main/tasks');
const tasks: { -readonly [K in keyof TasksModule]: TasksModule[K] } = { ...require('../../src/main/tasks') };
// Required just above, so it's in the cache.
require.cache[require.resolve('../../src/main/tasks')]!.exports = tasks;

// The window list comes from these instead of the helper.
let watcher: ((state: Tasks) => void) | null = null;
let state: Tasks = { accessibility: true, apps: [] };
let sent: HelperCommand[] = [];
let reply: HelperReply = { ok: true, windows: false }; // the helper's answer to hasWindows
// The quitter doesn't use what onChange returns.
tasks.onChange = ((fn) => { watcher = fn; }) as typeof tasks.onChange;
tasks.get = () => state;
tasks.send = async (command) => {
  sent.push(command);
  return command.cmd === 'hasWindows' ? reply : { ok: true };
};

// A made up app carries only what the quitter reads.
function app(pid: number, windows: string[], extra: Partial<TaskApp> = {}) {
  return { pid, name: `App ${pid}`, bundleId: `com.example.app${pid}`, path: `/Applications/App ${pid}.app`, hidden: false, windows: windows.map((id) => ({ id })), ...extra } as TaskApp;
}

function show(apps: TaskApp[], accessibility = true) {
  state = { accessibility, apps };
  // start() loaded the quitter, which set it.
  watcher!(state);
}

// A fresh quitter (it remembers each app's windows), settings and clock.
function start(t: TestContext, quitApps: Partial<Settings['quitApps']> = { on: true }) {
  tempAppData();
  settings.init();
  settings.update({ quitApps });
  sent = [];
  reply = { ok: true, windows: false };
  const clock = timers.install();
  t.after(() => clock.restore());
  delete require.cache[require.resolve('../../src/main/quitter')];
  (require('../../src/main/quitter') as QuitterModule).start();
  return clock;
}

const quit = () => sent.filter((c): c is AppCommand => c.cmd === 'quitApp').map((c) => c.pid);

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

test('nothing quits when more than one app loses its last window at once', async (t) => {
  const clock = start(t);
  show([app(1, ['w1']), app(2, ['w2']), app(3, ['w3'])]);
  show([app(1, []), app(2, []), app(3, ['w3'])]);
  await clock.advance(2000);
  assert.deepEqual(sent, []);
  show([app(1, ['w4']), app(2, ['w5']), app(3, ['w3'])]);
  await clock.advance(2000);
  assert.deepEqual(sent, [], 'the windows came back');
});

test('nothing quits while the screen is locked or just after', async (t) => {
  const clock = start(t);
  const quitter: QuitterModule = require('../../src/main/quitter');
  show([app(1, ['w1'])]);
  quitter.setLocked(true);
  show([app(1, [])]);
  await clock.advance(60000);
  assert.deepEqual(sent, []);
  quitter.setLocked(false);
  show([app(1, ['w1'])]);
  show([app(1, [])]);
  await clock.advance(4000);
  assert.deepEqual(sent, [], 'still just after the unlock');
  await clock.advance(1000);
  show([app(1, ['w1'])]);
  show([app(1, [])]);
  await clock.advance(1000);
  assert.deepEqual(quit(), [1]);
});

test('locking the screen during the wait stops the quit', async (t) => {
  const clock = start(t);
  show([app(1, ['w1'])]);
  show([app(1, [])]);
  (require('../../src/main/quitter') as QuitterModule).setLocked(true);
  await clock.advance(2000);
  assert.deepEqual(sent, []);
});
