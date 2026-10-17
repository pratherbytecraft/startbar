const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tempAppData } = require('../support/electron');
const settings = require('../../src/main/settings');

// ungrouped keeps its list and the live ids in memory, so each test loads
// it fresh, on a fresh settings folder.
function start() {
  tempAppData();
  settings.init();
  delete require.cache[require.resolve('../../src/main/ungrouped')];
  return require('../../src/main/ungrouped');
}

const file = () => path.join(settings.dataDir(), 'ungrouped.json');
const win = (id, title) => ({ id, title });
const state = (...apps) => ({ accessibility: true, apps });
const safari = (...wins) => ({ pid: 2, name: 'Safari', bundleId: 'com.apple.Safari', path: '/Applications/Safari.app', windows: wins });

test('a pulled out window is remembered by its app and title', () => {
  const u = start();
  const s = state(safari(win('w1', 'Apple'), win('w2', 'News')));
  u.ungroup('w2', s);
  assert.deepEqual(u.withIds(s).ungrouped, ['w2']);
  assert.deepEqual(JSON.parse(fs.readFileSync(file(), 'utf8')), [{ app: 'com.apple.Safari', title: 'News' }]);
});

test('it stays out when its title changes, and drops off when it closes', () => {
  const u = start();
  u.ungroup('w2', state(safari(win('w1', 'Apple'), win('w2', 'News'))));
  assert.deepEqual(u.withIds(state(safari(win('w1', 'Apple'), win('w2', 'Sports')))).ungrouped, ['w2']);
  assert.deepEqual(u.withIds(state(safari(win('w1', 'Apple')))).ungrouped, []);
  // The memory stays, so a window with that title comes back out.
  assert.deepEqual(u.withIds(state(safari(win('w1', 'Apple'), win('w9', 'News')))).ungrouped, ['w9']);
});

test('a saved entry comes back as its own button after a restart, one window per entry', () => {
  let u = start();
  u.ungroup('w2', state(safari(win('w1', 'Apple'), win('w2', 'News'))));
  delete require.cache[require.resolve('../../src/main/ungrouped')];
  u = require('../../src/main/ungrouped');
  assert.deepEqual(u.withIds(state(safari(win('w5', 'News'), win('w6', 'News')))).ungrouped, ['w5']);
  assert.deepEqual(u.withIds(state(safari(win('w5', 'News'), win('w6', 'News')))).ungrouped, ['w5']);
});

test('putting a window back forgets it, and put all back clears the file', () => {
  const u = start();
  const s = state(safari(win('w1', 'Apple'), win('w2', 'News'), win('w3', 'Weather')));
  u.ungroup('w2', s);
  u.ungroup('w3', s);
  const seen = [];
  u.onChange((ids) => seen.push(ids));
  u.regroup('w2');
  assert.deepEqual(u.withIds(s).ungrouped, ['w3']);
  assert.deepEqual(JSON.parse(fs.readFileSync(file(), 'utf8')), [{ app: 'com.apple.Safari', title: 'Weather' }]);
  u.putAllBack();
  assert.deepEqual(u.withIds(s).ungrouped, []);
  assert.deepEqual(JSON.parse(fs.readFileSync(file(), 'utf8')), []);
  assert.deepEqual(seen, [['w3'], []]);
});

test('an unknown id and a broken file are harmless', () => {
  const u = start();
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), '{not json');
  u.regroup('w1');
  u.ungroup('w404', state(safari(win('w1', 'Apple'))));
  assert.deepEqual(u.withIds(state(safari(win('w1', 'Apple')))).ungrouped, []);
});
