// The helper's icon and status modes, which need no permissions.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../support/helper');

test('icons are drawn once into the cache folder', async (t) => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'startbar-test-'));
  const icons = run('icons', cache);
  t.after(() => {
    icons.stop();
    fs.rmSync(cache, { recursive: true, force: true });
  });
  icons.write('/System/Applications/TextEdit.app');
  const first = await icons.waitFor((m) => m.path === '/System/Applications/TextEdit.app');
  assert.ok(first.png.startsWith(cache + '/'));
  const head = fs.readFileSync(first.png).subarray(0, 4);
  assert.deepEqual([...head], [0x89, 0x50, 0x4e, 0x47], 'a PNG file');
  const made = fs.statSync(first.png).mtimeMs;
  icons.write('/System/Applications/TextEdit.app');
  await icons.waitFor((m) => m !== first && m.path === '/System/Applications/TextEdit.app');
  assert.equal(fs.statSync(first.png).mtimeMs, made, 'drawn once');
  icons.write('/nowhere/Missing.app');
  assert.ok((await icons.waitFor((m) => m.path === '/nowhere/Missing.app')).png !== undefined);
});

test('status reports the tray items and the permissions it can see', async (t) => {
  const status = run('status');
  t.after(() => status.stop());
  const s = await status.waitFor((m) => m.type === 'status');
  for (const key of ['volume', 'wifi', 'battery', 'bluetooth', 'access']) assert.ok(key in s, key);
  if (s.volume) assert.ok(s.volume.level >= 0 && s.volume.level <= 1);
  assert.ok(['allowed', 'denied', 'notAsked', 'off', 'unknown'].includes(s.access.location), s.access.location);
});
