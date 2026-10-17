// Windows pulled out of their app's group onto their own button, see
// collapse in renderer/bar/bar.js. Saved by app and title in ungrouped.json
// next to pins.json, so the same window comes back as its own button after
// a restart while its title matches. While Startbar runs the window ids are
// kept too, so a window stays out when its title changes. The bar only sees
// the ids, added to the task state by withIds.
const fs = require('fs');
const path = require('path');
const settings = require('./settings');

let saved = null; // [{ app, title }], app is the bundle id or the path
const live = new Map(); // window id -> its entry in saved
const listeners = new Set();

function file() {
  return path.join(settings.dataDir(), 'ungrouped.json');
}

const appKey = (a) => a.bundleId || a.path || a.name || '';
const isEntry = (x) => !!x && typeof x === 'object' && typeof x.app === 'string' && typeof x.title === 'string';
const same = (x, y) => x.app === y.app && x.title === y.title;

function load() {
  try {
    const list = JSON.parse(fs.readFileSync(file(), 'utf8'));
    saved = Array.isArray(list) ? list.filter(isEntry) : [];
  } catch {
    saved = [];
  }
}

function get() {
  if (!saved) load();
  return saved;
}

function write(next) {
  saved = next;
  try {
    fs.writeFileSync(file(), JSON.stringify(saved, null, 2) + '\n');
  } catch (err) {
    console.log(`Startbar: could not save ungrouped.json: ${err.message}`);
  }
  for (const fn of listeners) fn(ids());
}

function ids() {
  return [...live.keys()];
}

// The task state with the ungrouped window ids added. A window already out
// stays out; a new window takes a saved entry with its app and title, one
// window per entry; a closed window drops off.
function withIds(state) {
  const seen = new Set();
  const taken = new Set(live.values());
  for (const a of state.apps || []) {
    const app = appKey(a);
    for (const w of a.windows || []) {
      seen.add(w.id);
      if (live.has(w.id)) continue;
      const hit = get().find((e) => !taken.has(e) && e.app === app && e.title === (w.title || ''));
      if (hit) {
        live.set(w.id, hit);
        taken.add(hit);
      }
    }
  }
  for (const id of [...live.keys()]) if (!seen.has(id)) live.delete(id);
  return { ...state, ungrouped: ids() };
}

// Pull the window with this id out of its group, remembered as the app and
// the title it has now.
function ungroup(id, state) {
  if (live.has(id)) return;
  for (const a of state.apps || []) {
    const w = (a.windows || []).find((x) => x.id === id);
    if (!w) continue;
    const e = { app: appKey(a), title: w.title || '' };
    live.set(id, e);
    write([...get(), e]);
    return;
  }
}

// Put the window back in its group and forget it.
function regroup(id) {
  const e = live.get(id);
  if (!e) return;
  live.delete(id);
  const list = get();
  const found = list.indexOf(e);
  const at = found >= 0 ? found : list.findIndex((x) => same(x, e));
  write(list.filter((_x, i) => i !== at));
}

function putAllBack() {
  live.clear();
  write([]);
}

function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

module.exports = { withIds, ungroup, regroup, putAllBack, ids, get, onChange, appKey };
