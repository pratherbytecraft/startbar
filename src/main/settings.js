// Settings live in ~/Library/Application Support/Startbar/settings.json.
// Missing keys fall back to the defaults, so a settings file from an older
// version keeps working after an update.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = Object.freeze({
  theme: 'system', // system | classic-2009 | classic-2001 | classic-1995
  appearance: 'auto', // auto | light | dark
  accent: 'auto', // auto | blue | purple | pink | red | orange | yellow | green | graphite
  translucent: true,
  barHeight: 36,
  labels: 'icon-and-title', // icon-and-title | icons-only
  maxButtonWidth: 180,
  taskbar: {
    showStartLabel: true, // the word Start next to the Start button's icon
    showPins: true,
    showDesktop: false, // a strip at the right end that hides every app, and brings them back
    pinsPlace: 'own', // own (their own spot next to Start) | row (in the row, each turning into its window buttons once open)
    grouping: 'always', // always | full | never
    clickActiveMinimizes: true,
    clickThrough: true, // a click on a window that isn't in front brings it forward and lands as a click
    titleOnHover: true,
    previews: false, // pictures of the windows over a button on hover, needs Screen Recording
    peek: true, // resting on a picture in a preview shows that window until the pointer moves off
    showWindowless: false, // apps that are running with no windows get a button
    order: 'opened', // opened | app
    hideInFullScreen: true,
    autoHide: false, // hide the bar until the mouse reaches the bottom edge
    moveWindowsUp: true // macOS can't reserve the bar's space, so windows are nudged up off it
  },
  tray: {
    volume: true,
    wifi: true, // shown when the Mac has Wi-Fi
    battery: true, // shown on laptops
    bluetooth: true, // shown once the Bluetooth permission is allowed
    collapseArrow: true, // the arrow at the left of the tray that hides its icons
    collapsed: false // the icons are hidden behind the arrow
  },
  clock: {
    hour12: true,
    seconds: false,
    showDate: false,
    dateStyle: 'short', // short (Oct 18) | weekday (Sat, Oct 18) | numeric (10/18/26) | dayFirst (18 Oct)
    click: 'calendar' // calendar (a small one above the clock) | app (the Calendar app) | nothing
  },
  startMenu: {
    showRecent: true, // recently used apps above All Applications
    recentCount: 5, // 1 to RECENT_MAX
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
  displays: {
    bars: 'all', // all | main: a bar on every display or the main one only
    buttons: 'display', // display | all: each bar's buttons are that display's windows, or every window
    tray: 'every' // every | main: the clock and tray on every bar or the main one only
  },
  spaces: {
    show: 'current' // current | all: windows from the current Space only, or from every Space
  },
  menuBarIcon: 'hidden', // hidden (only while the bar is hidden) | always
  quitApps: {
    on: false, // quit an app when its last window closes, see main/quitter.js
    keepRunning: [] // apps left running anyway, as paths
  },
  openFoldersWith: 'finder', // finder | filedrawer: the app the Start menu's folders open in, when Filedrawer is installed
  updates: {
    auto: true // check npm for a newer version now and then, never installs
  },
  accessibilityAsked: false, // the one time Accessibility dialog has been shown
  accessibilityStamp: '', // the app's build stamp while Accessibility last worked, see main/access.js
  screenAsked: false, // Screen Recording has been asked for, see checkScreen in main/index.js
  screenStamp: '', // the app's build stamp while Screen Recording last worked, see screenAfterUpdate
  hideNoteShown: false, // the one time note on how to bring a hidden bar back
  automationAnswer: '', // allowed | denied: the last answer for System Events, see main/index.js
  // A classic theme's color scheme, kept per theme. scheme is one of the
  // theme's schemes in renderer/shared/schemes.js; the rest are the Classic
  // 1995 Custom colors and Classic 2009's own glass color and strength.
  colors: {
    scheme: 'default',
    face: '#c0c0c0',
    selected: '#000080',
    title1: '#000080',
    title2: '#1084d0',
    tint: '#4a9ff5',
    intensity: 34
  },
  themes: {} // the THEME_KEYS of each theme that isn't the current one, by theme name
});

// The look and layout settings, kept per theme. The current theme's values
// live at the top level like every other setting, so the rest of Startbar
// reads them as usual; switching themes swaps them with the saved ones.
const THEME_KEYS = [
  'appearance', 'accent', 'translucent', 'barHeight', 'labels', 'maxButtonWidth',
  'taskbar.showStartLabel', 'taskbar.showPins', 'taskbar.pinsPlace', 'taskbar.showDesktop', 'taskbar.grouping',
  'clock.showDate', 'clock.dateStyle', 'tray.collapseArrow',
  'colors.scheme', 'colors.face', 'colors.selected', 'colors.title1', 'colors.title2', 'colors.tint', 'colors.intensity'
];

// A theme's own defaults over the shared ones, used the first time it's picked
// and by its reset.
const THEME_DEFAULTS = {
  'classic-2001': { colors: { scheme: 'blue' } },
  'classic-1995': { colors: { scheme: 'standard' } },
  'classic-2009': { barHeight: 40, labels: 'icons-only', taskbar: { pinsPlace: 'row', showDesktop: true }, clock: { showDate: true }, colors: { scheme: 'sky' } }
};

// The THEME_KEYS of s, in the same nested shape.
function pick(s) {
  const out = {};
  for (const key of THEME_KEYS) {
    const parts = key.split('.');
    const last = parts.pop();
    let from = s;
    let to = out;
    for (const part of parts) {
      from = from && from[part];
      to = to[part] = to[part] || {};
    }
    if (from && from[last] !== undefined) to[last] = from[last];
  }
  return out;
}

const THEME_SHAPE = pick(DEFAULTS);

function themeDefaults(theme) {
  return merge(THEME_SHAPE, THEME_DEFAULTS[theme]);
}

// A color scheme saved before the theme had a list of them reads as the
// theme's own default one.
function withScheme(s) {
  if (s.colors.scheme !== 'default') return s;
  return merge(s, { colors: { scheme: themeDefaults(s.theme).colors.scheme } });
}

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
  // A value of the wrong kind, from a hand-edited file say, falls back to
  // the default instead of being taken as it is ("false" would read as on).
  current = withScheme(merge(DEFAULTS, clean(saved, DEFAULTS)));
  // Up to ten could be shown before 2026-10.
  if (current.startMenu.recentCount > RECENT_MAX) current = merge(current, { startMenu: { recentCount: RECENT_MAX } });
  return current;
}

function get() {
  return current;
}

function dataDir() {
  return dir;
}

const RECENT_MAX = 5;

function save() {
  fs.writeFileSync(file, JSON.stringify(current, null, 2) + '\n');
  for (const fn of listeners) fn(current);
  return current;
}

function update(patch) {
  // A new theme puts the old one's look away and brings out its own, or its
  // defaults the first time. The rest of the patch goes on top.
  if (patch && typeof patch.theme === 'string' && patch.theme !== current.theme) {
    const themes = { ...current.themes, [current.theme]: pick(current) };
    const own = merge(themeDefaults(patch.theme), themes[patch.theme]);
    delete themes[patch.theme];
    current = merge({ ...current, themes }, own);
  }
  current = withScheme(merge(current, patch));
  return save();
}

// The current theme's look back to its defaults. Other themes keep theirs.
function resetTheme() {
  current = merge(current, themeDefaults(current.theme));
  return save();
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
    if (base === DEFAULTS && key === 'themes') {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        out.themes = {};
        for (const name of Object.keys(v)) {
          const t = v[name];
          if (t && typeof t === 'object' && !Array.isArray(t)) out.themes[name] = clean(t, THEME_SHAPE);
        }
      }
    } else if (Array.isArray(b)) {
      if (Array.isArray(v)) out[key] = v.filter((x) => typeof x === 'string');
    } else if (b && typeof b === 'object') {
      out[key] = clean(v, b);
    } else if (typeof v === typeof b) {
      out[key] = v;
    }
  }
  return out;
}

// The one time answers. They stay through an import and a reset, and an
// export leaves them out.
const ONE_TIME = ['accessibilityAsked', 'accessibilityStamp', 'hideNoteShown', 'automationAnswer', 'screenAsked', 'screenStamp'];

// Everything from saved, the rest from the defaults, for an import. The one
// time dialogs stay answered.
function replace(saved) {
  const kept = Object.fromEntries(ONE_TIME.map((key) => [key, current[key]]));
  current = withScheme(merge(merge(DEFAULTS, clean(saved, DEFAULTS)), kept));
  return save();
}

// The settings for an export file.
function forExport() {
  const out = { ...current };
  for (const key of ONE_TIME) delete out[key];
  return out;
}

// Back to the defaults.
function reset() {
  return replace({});
}

function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

module.exports = { DEFAULTS, init, get, update, replace, reset, resetTheme, forExport, onChange, dataDir };
