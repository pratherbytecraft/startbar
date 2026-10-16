// Pinned apps, the icons next to the Start button. Saved as a list of app
// paths in ~/Library/Application Support/Startbar/pins.json.
const fs = require('fs');
const path = require('path');
const settings = require('./settings');

// Used until pins.json exists. Apps that aren't installed are left out.
const DEFAULTS = [
  '/System/Library/CoreServices/Finder.app',
  '/Applications/Safari.app',
  '/System/Applications/Utilities/Terminal.app'
];

let list = null;
const listeners = new Set();

function file() {
  return path.join(settings.dataDir(), 'pins.json');
}

function isApp(p) {
  return typeof p === 'string' && path.isAbsolute(p) && p.endsWith('.app');
}

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(file(), 'utf8'));
    list = Array.isArray(saved) ? saved.filter(isApp) : [];
  } catch (err) {
    list = err.code === 'ENOENT' ? DEFAULTS.filter((p) => fs.existsSync(p)) : [];
  }
}

// The pins in order. An app that has been deleted drops off the bar.
function get() {
  if (!list) load();
  return list.filter((p) => fs.existsSync(p));
}

function has(p) {
  return get().includes(p);
}

function set(next) {
  list = [...new Set((Array.isArray(next) ? next : []).filter(isApp))];
  fs.writeFileSync(file(), JSON.stringify(list, null, 2) + '\n');
  for (const fn of listeners) fn(get());
}

function add(...paths) {
  set([...get(), ...paths]);
}

function remove(p) {
  set(get().filter((x) => x !== p));
}

function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

module.exports = { get, has, set, add, remove, isApp, onChange };
