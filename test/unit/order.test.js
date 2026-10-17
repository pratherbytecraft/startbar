const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tempAppData } = require('../support/electron');
const settings = require('../../src/main/settings');
const { load, plain } = require('../support/renderer');

// main/order.js keeps the saved list in memory, so each test loads it fresh,
// on a fresh settings folder.
function start() {
  tempAppData();
  settings.init();
  delete require.cache[require.resolve('../../src/main/order')];
  return require('../../src/main/order');
}
const file = () => path.join(settings.dataDir(), 'order.json');

test('a new order is saved, with what isn\'t on the bar kept after what it followed', () => {
  const order = start();
  order.set(['app:a', 'app:b', 'app:c'], []);
  order.set(['app:c', 'app:a'], []); // b's app isn't open now
  assert.deepEqual(order.get(), ['app:c', 'app:a', 'app:b']);
  assert.deepEqual(JSON.parse(fs.readFileSync(file(), 'utf8')), ['app:c', 'app:a', 'app:b']);
  assert.deepEqual(order.merge(['app:x', 'app:a', 'app:y'], ['app:a']), ['app:x', 'app:a', 'app:y']);
});

test('a closed window\'s key is dropped, apps stay, and odd keys are ignored', () => {
  const order = start();
  order.set(['app:a', 'win:w1', 'win:w2', 'nope', 3], ['w2']);
  assert.deepEqual(order.get(), ['app:a', 'win:w2']);
  assert.deepEqual(order.withOrder({ apps: [] }).order, ['app:a', 'win:w2']);
});

test('a broken order.json starts empty', () => {
  start();
  fs.writeFileSync(file(), '{ broken');
  const order = (delete require.cache[require.resolve('../../src/main/order')], require('../../src/main/order'));
  assert.deepEqual(order.get(), []);
});

const { byOrder, orderKeys } = load('order.js');
const app = (id) => ({ bundleId: id, name: id });
const A = app('a');
const B = app('b');
const C = app('c');
const win = (a, id) => ({ kind: 'window', app: a, win: { id } });
const names = (items) => plain(items).map((it) => (it.kind === 'window' ? it.win.id : it.app.bundleId));

test('without a saved order the bar keeps its own order', () => {
  const items = [win(A, 'w1'), win(B, 'w2')];
  assert.equal(byOrder(items, []), items);
});

test('buttons follow the saved order, and new ones go after their app or at the end', () => {
  const items = [win(A, 'w1'), win(B, 'w2'), win(C, 'w3'), win(B, 'w4'), win(A, 'w5')];
  // dragged before: b's window first, then a's
  const order = ['app:b', 'win:w2', 'app:a', 'win:w1'];
  // w4 is new for b: after b's last button; w5 is new for a; c is new: at the end
  assert.deepEqual(names(byOrder(items, order)), ['w2', 'w4', 'w1', 'w5', 'w3']);
});

test('after a restart an app\'s windows, with new ids, come back where the app was', () => {
  const items = [win(A, 'n1'), win(B, 'n2'), win(A, 'n3')];
  assert.deepEqual(names(byOrder(items, ['app:b', 'win:old', 'app:a'])), ['n2', 'n1', 'n3']);
});

test('groups and windowless apps are kept by app', () => {
  const items = [{ kind: 'group', app: A, wins: [] }, { kind: 'app', app: B }];
  assert.deepEqual(names(byOrder(items, ['app:b', 'app:a'])), ['b', 'a']);
});

test('the keys to save mark each app at its first button', () => {
  const items = [win(B, 'w2'), { kind: 'group', app: A, wins: [] }, win(B, 'w4'), win(A, 'w1')];
  assert.deepEqual(plain(orderKeys(items)), ['app:b', 'win:w2', 'app:a', 'win:w4', 'win:w1']);
});
