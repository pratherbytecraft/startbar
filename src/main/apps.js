// The list of installed apps for the Start menu, with icons, plus the
// recently used list. Icons come from the Swift helper, with Electron as the fallback.
const { app } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const settings = require('./settings');
const { helperPath } = require('../../scripts/build-helper');

const APP_DIRS = [
  '/Applications',
  '/Applications/Utilities',
  path.join(os.homedir(), 'Applications'),
  '/System/Applications',
  '/System/Applications/Utilities'
];

let cache = null; // [{ name, path, icon }]
let loading = null;
const iconCache = new Map();

function listAppBundles() {
  const seen = new Set();
  const out = [];
  for (const dir of APP_DIRS) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.name.endsWith('.app')) continue;
      const full = path.join(dir, e.name);
      if (seen.has(full)) continue;
      seen.add(full);
      out.push({ name: e.name.slice(0, -4), path: full });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return out;
}

// Electron's own icon lookup fallback. On recent macOS it returns a generic
// document icon for app bundles, so the Swift helper is preferred.
async function electronIcon(appPath) {
  try {
    const img = await app.getFileIcon(appPath, { size: 'normal' });
    return img.toDataURL();
  } catch {
    return '';
  }
}

function toDataUrl(pngPath) {
  try {
    return 'data:image/png;base64,' + fs.readFileSync(pngPath).toString('base64');
  } catch {
    return '';
  }
}

// Asks the helper for every missing icon in one run. Resolves to a Map of
// app path to data URL.
function helperIcons(paths) {
  const helper = helperPath();
  if (!helper || paths.length === 0) return Promise.resolve(new Map());
  return new Promise((resolve) => {
    const result = new Map();
    const child = spawn(helper, ['icons', path.join(settings.dataDir(), 'icons')]);
    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      try {
        const { path: p, png } = JSON.parse(line);
        if (png) result.set(p, toDataUrl(png));
      } catch {
        // skip a bad line
      }
    });
    child.on('error', () => resolve(result));
    child.on('close', () => resolve(result));
    child.stdin.write(paths.join('\n') + '\n');
    child.stdin.end();
  });
}

async function iconFor(appPath) {
  if (iconCache.has(appPath)) return iconCache.get(appPath);
  const fromHelper = await helperIcons([appPath]);
  const url = fromHelper.get(appPath) || (await electronIcon(appPath));
  iconCache.set(appPath, url);
  return url;
}

async function withIcons(list) {
  const missing = list.filter((a) => !iconCache.has(a.path)).map((a) => a.path);
  const fromHelper = await helperIcons(missing);
  const out = [];
  for (const a of list) {
    if (!iconCache.has(a.path)) {
      iconCache.set(a.path, fromHelper.get(a.path) || (await electronIcon(a.path)));
    }
    out.push({ ...a, icon: iconCache.get(a.path) });
  }
  return out;
}

function load(force = false) {
  if (cache && !force) return Promise.resolve(cache);
  if (loading) return loading;
  loading = withIcons(listAppBundles()).then((list) => {
    cache = list;
    loading = null;
    return list;
  });
  return loading;
}

// Recent apps: most recently launched first.
function recentFile() {
  return path.join(settings.dataDir(), 'recent.json');
}

function readRecent() {
  try {
    const list = JSON.parse(fs.readFileSync(recentFile(), 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function noteLaunch(appPath) {
  const list = readRecent().filter((p) => p !== appPath);
  list.unshift(appPath);
  fs.writeFileSync(recentFile(), JSON.stringify(list.slice(0, 30), null, 2) + '\n');
}

async function recent(count) {
  const all = await load();
  const byPath = new Map(all.map((a) => [a.path, a]));
  return readRecent()
    .map((p) => byPath.get(p))
    .filter(Boolean)
    .slice(0, count);
}

module.exports = { load, recent, noteLaunch, iconFor };
