// Settings live in ~/Library/Application Support/Startbar/settings.json.
// Missing keys fall back to the defaults, so a settings file from an older
// version keeps working after an update.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = Object.freeze({
  theme: 'system', // system | classic-2001
  appearance: 'auto', // auto | light | dark
  accent: 'auto', // auto | blue | purple | pink | red | orange | yellow | green | graphite
  translucent: true,
  barHeight: 36,
  labels: 'icon-and-title', // icon-and-title | icons-only
  maxButtonWidth: 180,
  clock: {
    hour12: true,
    seconds: false,
    showDate: false,
    dateStyle: 'short' // short (Oct 18) | weekday (Sat, Oct 18) | numeric (10/18/26) | dayFirst (18 Oct)
  },
  startMenu: {
    recentCount: 6,
    focusSearch: true,
    rightColumn: {
      applications: true,
      documents: true,
      downloads: true,
      home: true,
      systemSettings: true
    },
    showPower: true,
    confirmPower: true,
    shortcut: 'Control+Space'
  }
});

let dir;
let file;
let current;
const listeners = new Set();

function merge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return base;
  const out = { ...base };
  for (const key of Object.keys(over)) {
    const b = base[key];
    out[key] = b && typeof b === 'object' && !Array.isArray(b) ? merge(b, over[key]) : over[key];
  }
  return out;
}

function init() {
  dir = path.join(app.getPath('appData'), 'Startbar');
  file = path.join(dir, 'settings.json');
  fs.mkdirSync(dir, { recursive: true });
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    saved = {};
  }
  current = merge(DEFAULTS, saved);
  return current;
}

function get() {
  return current;
}

function dataDir() {
  return dir;
}

function update(patch) {
  current = merge(current, patch);
  fs.writeFileSync(file, JSON.stringify(current, null, 2) + '\n');
  for (const fn of listeners) fn(current);
  return current;
}

function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

module.exports = { DEFAULTS, init, get, update, onChange, dataDir };
