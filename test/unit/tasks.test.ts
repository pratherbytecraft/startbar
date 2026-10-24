import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as timers from '../support/timers';
import type { TaskApp } from '../../src/shared/types';

// A fresh tasks module (it remembers which Finder windows it has seen) and
// clock. hold says whether Filedrawer is taking over Finder windows.
function start(t: TestContext, hold = true) {
  const clock = timers.install();
  t.after(() => clock.restore());
  delete require.cache[require.resolve('../../src/main/tasks')];
  const tasks: typeof import('../../src/main/tasks') = require('../../src/main/tasks');
  tasks.setHoldFinder(() => hold);
  return { clock, tasks };
}

// Made up apps carry only what heldBack reads.
const finder = (...ids: string[]) => ({ pid: 1, bundleId: 'com.apple.finder', windows: ids.map((id) => ({ id })) }) as TaskApp;
const other = (...ids: string[]) => ({ pid: 2, bundleId: 'com.example.app', windows: ids.map((id) => ({ id })) }) as TaskApp;
const ids = (apps: TaskApp[]) => apps.map((a) => a.windows.map((w) => w.id));

test('Finder windows open when Startbar starts show at once', (t) => {
  const { tasks } = start(t);
  assert.deepEqual(ids(tasks.heldBack([finder('w1', 'w2')])), [['w1', 'w2']]);
});

test('a new Finder window waits a second while Filedrawer takes over', async (t) => {
  const { clock, tasks } = start(t);
  tasks.heldBack([finder('w1')]);
  assert.deepEqual(ids(tasks.heldBack([finder('w1', 'w2')])), [['w1']]);
  await clock.advance(999);
  assert.deepEqual(ids(tasks.heldBack([finder('w1', 'w2')])), [['w1']]);
  await clock.advance(1);
  assert.deepEqual(ids(tasks.heldBack([finder('w1', 'w2')])), [['w1', 'w2']]);
});

test('a window Filedrawer closes within the second never shows', async (t) => {
  const { clock, tasks } = start(t);
  tasks.heldBack([finder()]);
  assert.deepEqual(ids(tasks.heldBack([finder('w1')])), [[]]);
  await clock.advance(300);
  assert.deepEqual(ids(tasks.heldBack([finder()])), [[]]);
  await clock.advance(2000);
  assert.deepEqual(ids(tasks.heldBack([finder()])), [[]]);
});

test('without the takeover new Finder windows show at once', (t) => {
  const { tasks } = start(t, false);
  tasks.heldBack([finder('w1')]);
  assert.deepEqual(ids(tasks.heldBack([finder('w1', 'w2')])), [['w1', 'w2']]);
});

test('other apps are never held back', (t) => {
  const { tasks } = start(t);
  tasks.heldBack([finder(), other()]);
  assert.deepEqual(ids(tasks.heldBack([finder('w1'), other('a1')])), [[], ['a1']]);
});
