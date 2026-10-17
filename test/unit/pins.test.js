const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tempAppData } = require('../support/electron');
const settings = require('../../src/main/settings');

// pins keeps its list in memory once read, so each test loads it fresh.
function freshPins() {
  delete require.cache[require.resolve('../../src/main/pins')];
  return require('../../src/main/pins');
}

// A fresh settings folder with fake apps in it, as folders named X.app.
function start(apps = []) {
  const root = tempAppData();
  settings.init();
  const made = {};
  for (const name of apps) {
    made[name] = path.join(root, 'Apps', `${name}.app`);
    fs.mkdirSync(made[name], { recursive: true });
  }
  return { apps: made, file: path.join(settings.dataDir(), 'pins.json') };
}

test('isApp takes absolute .app paths only', () => {
  const pins = freshPins();
  assert.equal(pins.isApp('/Applications/Safari.app'), true);
  assert.equal(pins.isApp('Safari.app'), false);
  assert.equal(pins.isApp('/Applications/notes.txt'), false);
  assert.equal(pins.isApp(null), false);
});

test('a first run pins the default apps that are installed', () => {
  start();
  const pins = freshPins();
  const list = pins.get();
  assert.ok(list.length > 0);
  for (const p of list) assert.ok(fs.existsSync(p), p);
});

test('set keeps the order, drops doubles and anything not an app, and saves', () => {
  const { apps, file } = start(['A', 'B', 'C']);
  const pins = freshPins();
  pins.set([apps.B, 'relative.app', apps.A, apps.B, '/tmp/file.txt', apps.C]);
  assert.deepEqual(pins.get(), [apps.B, apps.A, apps.C]);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), [apps.B, apps.A, apps.C]);
});

test('add puts apps at the end, remove takes one out, has answers', () => {
  const { apps } = start(['A', 'B', 'C']);
  const pins = freshPins();
  pins.set([apps.A]);
  pins.add(apps.B, apps.C, apps.A);
  assert.deepEqual(pins.get(), [apps.A, apps.B, apps.C]);
  pins.remove(apps.B);
  assert.deepEqual(pins.get(), [apps.A, apps.C]);
  assert.equal(pins.has(apps.C), true);
  assert.equal(pins.has(apps.B), false);
});

test('an app deleted from the disk drops off', () => {
  const { apps } = start(['A', 'B']);
  const pins = freshPins();
  pins.set([apps.A, apps.B]);
  fs.rmSync(apps.A, { recursive: true });
  assert.deepEqual(pins.get(), [apps.B]);
});

test('a saved list is read back, without the entries that are not apps', () => {
  const { apps, file } = start(['A']);
  fs.writeFileSync(file, JSON.stringify([apps.A, 42, 'x.txt']));
  assert.deepEqual(freshPins().get(), [apps.A]);
});

test('a broken pins file means no pins rather than the defaults', () => {
  const { file } = start();
  fs.writeFileSync(file, '{ broken');
  assert.deepEqual(freshPins().get(), []);
});

test('listeners hear each change', () => {
  const { apps } = start(['A', 'B']);
  const pins = freshPins();
  const seen = [];
  const stop = pins.onChange((list) => seen.push(list.length));
  pins.set([apps.A]);
  pins.add(apps.B);
  stop();
  pins.remove(apps.A);
  assert.deepEqual(seen, [1, 2]);
});
