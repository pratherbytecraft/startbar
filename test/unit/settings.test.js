const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tempAppData } = require('../support/electron');
const settings = require('../../src/main/settings');

// A fresh settings folder, with settings.json holding saved when given.
function start(saved) {
  const dir = path.join(tempAppData(), 'Startbar');
  if (saved !== undefined) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'settings.json'), typeof saved === 'string' ? saved : JSON.stringify(saved));
  }
  settings.init();
  return path.join(dir, 'settings.json');
}

const onDisk = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('a first run gets the defaults', () => {
  start();
  assert.deepEqual(settings.get(), settings.DEFAULTS);
});

test('only a launch without a settings file is a first run', () => {
  start();
  assert.equal(settings.firstRun(), true);
  start({ barHeight: 44 });
  assert.equal(settings.firstRun(), false);
});

test('a broken settings file gets the defaults', () => {
  start('{ not json');
  assert.deepEqual(settings.get(), settings.DEFAULTS);
});

test('a saved file keeps what it has and takes the defaults for the rest', () => {
  start({ barHeight: 44, taskbar: { previews: true } });
  const s = settings.get();
  assert.equal(s.barHeight, 44);
  assert.equal(s.taskbar.previews, true);
  assert.equal(s.taskbar.showPins, settings.DEFAULTS.taskbar.showPins);
  assert.deepEqual(s.clock, settings.DEFAULTS.clock);
});

test('values of the wrong kind and unknown keys are dropped', () => {
  start({
    translucent: 'false',
    barHeight: '50',
    madeUp: true,
    taskbar: { previews: 1, nonsense: 'x' },
    startMenu: { folders: ['/Users/a', 7, null, '/Users/b'] },
    clock: 'not an object'
  });
  const s = settings.get();
  assert.equal(s.translucent, true);
  assert.equal(s.barHeight, settings.DEFAULTS.barHeight);
  assert.equal('madeUp' in s, false);
  assert.equal(s.taskbar.previews, false);
  assert.equal('nonsense' in s.taskbar, false);
  assert.deepEqual(s.startMenu.folders, ['/Users/a', '/Users/b']);
  assert.deepEqual(s.clock, settings.DEFAULTS.clock);
});

test('more recent apps than the Start menu shows are cut to five', () => {
  start({ startMenu: { recentCount: 10 } });
  assert.equal(settings.get().startMenu.recentCount, 5);
});

test('a color scheme saved before schemes existed reads as the theme default', () => {
  start({ theme: 'classic-2001', colors: { scheme: 'default' } });
  assert.equal(settings.get().colors.scheme, 'blue');
});

test('update merges into nested settings, saves and tells listeners', () => {
  const file = start();
  const seen = [];
  const stop = settings.onChange((s) => seen.push(s.clock.seconds));
  settings.update({ clock: { seconds: true } });
  stop();
  assert.equal(settings.get().clock.seconds, true);
  assert.equal(settings.get().clock.hour12, true);
  assert.deepEqual(seen, [true]);
  assert.equal(onDisk(file).clock.seconds, true);
});

test('a list in an update replaces the old list', () => {
  start({ startMenu: { folders: ['/a', '/b'] } });
  settings.update({ startMenu: { folders: ['/c'] } });
  assert.deepEqual(settings.get().startMenu.folders, ['/c']);
});

test('each theme keeps its own look', () => {
  start();
  settings.update({ barHeight: 50, translucent: false });
  settings.update({ theme: 'classic-2009' });
  let s = settings.get();
  assert.equal(s.barHeight, 40, 'Classic 2009 starts at its own height');
  assert.equal(s.labels, 'icons-only');
  assert.equal(s.taskbar.pinsPlace, 'row');
  assert.equal(s.colors.scheme, 'sky');
  assert.equal(s.translucent, true, 'look keys the theme leaves alone start at the shared default');

  settings.update({ barHeight: 44 });
  settings.update({ theme: 'system' });
  s = settings.get();
  assert.equal(s.barHeight, 50);
  assert.equal(s.translucent, false);
  assert.equal(s.labels, 'icon-and-title');

  settings.update({ theme: 'classic-2009' });
  assert.equal(settings.get().barHeight, 44);
});

test('settings that are not part of the look stay put across a theme switch', () => {
  start();
  settings.update({ clock: { seconds: true }, taskbar: { previews: true } });
  settings.update({ theme: 'classic-1995' });
  const s = settings.get();
  assert.equal(s.clock.seconds, true);
  assert.equal(s.taskbar.previews, true);
  assert.equal(s.colors.scheme, 'standard');
});

test('a theme change and other keys in one update', () => {
  start();
  settings.update({ theme: 'classic-2009', barHeight: 48 });
  assert.equal(settings.get().barHeight, 48);
});

test('reset theme puts back only the current theme look', () => {
  start();
  settings.update({ theme: 'classic-2009' });
  settings.update({ barHeight: 30, updates: { auto: false } });
  settings.resetTheme();
  const s = settings.get();
  assert.equal(s.barHeight, 40);
  assert.equal(s.updates.auto, false);
  assert.equal(s.theme, 'classic-2009');
});

test('an import replaces everything but the one time answers', () => {
  start();
  settings.update({ accessibilityAsked: true, screenStamp: 'abc', hideNoteShown: true, clock: { seconds: true } });
  settings.replace({ theme: 'classic-1995', accessibilityAsked: false, screenStamp: 'other' });
  const s = settings.get();
  assert.equal(s.theme, 'classic-1995');
  assert.equal(s.colors.scheme, 'standard');
  assert.equal(s.clock.seconds, false);
  assert.equal(s.accessibilityAsked, true);
  assert.equal(s.screenStamp, 'abc');
  assert.equal(s.hideNoteShown, true);
});

test('reset goes back to the defaults and keeps the one time answers', () => {
  const file = start();
  settings.update({ barHeight: 50, automationAnswer: 'allowed' });
  settings.reset();
  assert.equal(settings.get().barHeight, settings.DEFAULTS.barHeight);
  assert.equal(settings.get().automationAnswer, 'allowed');
  assert.equal(onDisk(file).barHeight, settings.DEFAULTS.barHeight);
});

test('an export leaves out the one time answers', () => {
  start();
  settings.update({ accessibilityAsked: true, screenAsked: true, barHeight: 42 });
  const out = settings.forExport();
  assert.equal(out.barHeight, 42);
  for (const key of ['accessibilityAsked', 'accessibilityStamp', 'hideNoteShown', 'automationAnswer', 'screenAsked', 'screenStamp']) {
    assert.equal(key in out, false, key);
  }
  assert.equal(settings.get().accessibilityAsked, true, 'the settings themselves keep them');
});

test('an exported file imports back to the same settings', () => {
  start();
  settings.update({ theme: 'classic-2001', barHeight: 38, startMenu: { folders: ['/x'] } });
  const exported = JSON.parse(JSON.stringify(settings.forExport()));
  const before = settings.get();
  start();
  settings.replace(exported);
  assert.deepEqual(settings.get(), before);
});
