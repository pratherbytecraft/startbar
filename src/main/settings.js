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
  taskbar: {
    showStartLabel: true, // the word Start next to the Start button's icon
    showPins: true,
    grouping: 'always', // always | full | never
    clickActiveMinimizes: true,
    titleOnHover: true,
    showWindowless: false, // apps that are running with no windows get a button
    order: 'opened', // opened | app
    hideInFullScreen: true,
    autoHide: false, // hide the bar until the mouse reaches the bottom edge
    moveWindowsUp: true // macOS can't reserve the bar's space, so windows are nudged up off it
  },
  clock: {
    hour12: true,
    seconds: false,
    showDate: false,
    dateStyle: 'short', // short (Oct 18) | weekday (Sat, Oct 18) | numeric (10/18/26) | dayFirst (18 Oct)
    click: 'calendar' // calendar (a small one above the clock) | app (the Calendar app) | nothing
  },
  startMenu: {
    recentCount: 6,
    focusSearch: true,
    search: 'apps', // apps | files (apps and files in the home folder)
    rightColumn: {
      applications: true,
      documents: true,
      downloads: true,
      home: true,
      systemSettings: true
    },
    folders: [], // folders added to the right column, as paths
    showPower: true,
    confirmPower: true,
    shortcut: 'Control+Space'
  },
  menuBarIcon: 'hidden', // hidden (only while the bar is hidden) | always
  updates: {
    auto: true // check npm for a newer version now and then, never installs
  },
  accessibilityAsked: false, // the one time Accessibility dialog has been shown
  hideNoteShown: false // the one time note on how to bring a hidden bar back
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

// Only the keys Startbar knows, each with the same kind of value as its
// default. Guards an imported file.
function clean(saved, base) {
  const out = {};
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return out;
  for (const key of Object.keys(base)) {
    const b = base[key];
    const v = saved[key];
    if (v === undefined) continue;
    if (Array.isArray(b)) {
      if (Array.isArray(v)) out[key] = v.filter((x) => typeof x === 'string');
    } else if (b && typeof b === 'object') {
      out[key] = clean(v, b);
    } else if (typeof v === typeof b) {
      out[key] = v;
    }
  }
  return out;
}

// Everything from saved, the rest from the defaults, for an import. The one
// time dialogs stay answered.
function replace(saved) {
  const { accessibilityAsked, hideNoteShown } = current;
  current = merge(merge(DEFAULTS, clean(saved, DEFAULTS)), { accessibilityAsked, hideNoteShown });
  fs.writeFileSync(file, JSON.stringify(current, null, 2) + '\n');
  for (const fn of listeners) fn(current);
  return current;
}

// Back to the defaults.
function reset() {
  return replace({});
}

function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

module.exports = { DEFAULTS, init, get, update, replace, reset, onChange, dataDir };
