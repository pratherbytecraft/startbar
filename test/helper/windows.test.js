// Startbar's window helper against a real window: TextEdit on a temp file.
// Needs Accessibility for the app running the tests (the terminal), and
// steps aside while TextEdit is already open so nobody's documents are
// touched. TextEdit is quit at the end.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../support/helper');

const running = (name) => {
  try {
    execFileSync('pgrep', ['-x', name]);
    return true;
  } catch {
    return false;
  }
};

const helper = run('windows');
after(() => helper.stop());

describe('the window list', async () => {
  const permission = await helper.waitFor((m) => m.type === 'permission');
  const why = !permission.accessibility ? 'the app running the tests has no Accessibility permission'
    : running('TextEdit') ? 'TextEdit is already open' : null;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'startbar-test-'));
  const file = path.join(dir, `Startbar test ${process.pid}.txt`);
  const textEdit = (state) => state.type === 'state' && state.apps.find((a) => a.bundleId === 'com.apple.TextEdit');
  let app = null;
  let win = null;

  before(async () => {
    if (why) return;
    fs.writeFileSync(file, 'A window for the Startbar tests.\n');
    execFileSync('open', ['-g', '-a', 'TextEdit', file]);
    const state = await helper.waitFor((m) => {
      const a = textEdit(m);
      return a && a.windows.some((w) => w.title === path.basename(file));
    }, 15000);
    app = textEdit(state);
    win = app.windows.find((w) => w.title === path.basename(file));
  });

  after(async () => {
    if (!why && running('TextEdit')) {
      await helper.send({ cmd: 'quitApp', pid: app.pid });
      for (let i = 0; i < 50 && running('TextEdit'); i++) await new Promise((r) => setTimeout(r, 100));
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('lists the app and its window', { skip: why || false }, () => {
    assert.equal(app.name, 'TextEdit');
    assert.equal(app.path, '/System/Applications/TextEdit.app');
    assert.match(win.id, /^w\d+$/);
    assert.equal(win.minimized, false);
    assert.ok(win.w > 0 && win.h > 0);
  });

  test('minimizes and brings the window back', { skip: why || false }, async () => {
    const isMin = (want) => (m) => {
      const a = textEdit(m);
      return a && a.windows.some((w) => w.id === win.id && w.minimized === want);
    };
    let next = helper.waitForNext(isMin(true));
    assert.equal((await helper.send({ cmd: 'minimize', id: win.id })).ok, true);
    await next;
    assert.equal((await helper.send({ cmd: 'hasWindows', pid: app.pid, ids: [win.id] })).windows, true, 'a minimized window counts');
    next = helper.waitForNext(isMin(false));
    assert.equal((await helper.send({ cmd: 'unminimize', id: win.id })).ok, true);
    await next;
  });

  test('activates the window', { skip: why || false }, async () => {
    const next = helper.waitForNext((m) => {
      const a = textEdit(m);
      return a && a.active && a.windows.some((w) => w.id === win.id && w.focused && !w.minimized);
    });
    assert.equal((await helper.send({ cmd: 'activate', id: win.id })).ok, true);
    await next;
  });

  test('closes the window, after which the app has none', { skip: why || false }, async () => {
    const next = helper.waitForNext((m) => {
      const a = textEdit(m);
      return a && !a.windows.some((w) => w.id === win.id);
    });
    assert.equal((await helper.send({ cmd: 'close', id: win.id })).ok, true);
    await next;
    // TextEdit keeps a closed window around out of sight; it mustn't count.
    assert.equal((await helper.send({ cmd: 'hasWindows', pid: app.pid, ids: [win.id] })).windows, false);
  });

  test('opens a new window and raises it', { skip: why || false }, async () => {
    const next = helper.waitForNext((m) => {
      const a = textEdit(m);
      return a && a.active && a.windows.some((w) => w.focused && !w.minimized);
    });
    assert.equal((await helper.send({ cmd: 'newWindow', pid: app.pid })).ok, true);
    const fresh = textEdit(await next).windows.find((w) => w.focused);
    assert.equal((await helper.send({ cmd: 'close', id: fresh.id })).ok, true);
  });

  test('quits the app', { skip: why || false }, async () => {
    const next = helper.waitForNext((m) => m.type === 'state' && !textEdit(m));
    assert.equal((await helper.send({ cmd: 'quitApp', pid: app.pid })).ok, true);
    await next;
  });

  test('a window that is not there gets an error', { skip: permission.accessibility ? false : 'no Accessibility' }, async () => {
    const reply = await helper.send({ cmd: 'activate', id: 'w0' });
    assert.equal(reply.ok, false);
    assert.equal(reply.error, 'no such window');
  });
});
