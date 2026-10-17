// The order of the bar's buttons once some were dragged, as keys (see
// renderer/shared/order.js), saved in order.json next to pins.json. Apps
// keep their place across restarts. Windows are kept by id, which lasts as
// long as the window, so a closed window's key is dropped.
const fs = require('fs');
const path = require('path');
const settings = require('./settings');

const MAX = 400;
let saved = null;
const listeners = new Set();

function file() {
  return path.join(settings.dataDir(), 'order.json');
}

function get() {
  if (saved) return saved;
  try {
    const list = JSON.parse(fs.readFileSync(file(), 'utf8'));
    saved = Array.isArray(list) ? list.filter((k) => typeof k === 'string' && /^(app|win):/.test(k)) : [];
  } catch {
    saved = [];
  }
  return saved;
}

// The keys on the bar now, in their new order, with every saved key that
// isn't on the bar put back after the key it followed before.
function merge(old, shown) {
  const on = new Set(shown);
  const out = [...shown];
  let prev = null;
  for (const k of old) {
    if (on.has(k)) {
      prev = k;
      continue;
    }
    out.splice(prev === null ? 0 : out.indexOf(prev) + 1, 0, k);
    prev = k;
  }
  return out;
}

// shown is the bar's keys in the order it was dragged into, open is the ids
// of every window open now.
function set(shown, open) {
  const ids = new Set(open.map(String));
  const keys = shown.filter((k) => typeof k === 'string' && /^(app|win):/.test(k));
  saved = merge(get(), keys).filter((k) => !k.startsWith('win:') || ids.has(k.slice(4))).slice(0, MAX);
  try {
    fs.writeFileSync(file(), JSON.stringify(saved, null, 2) + '\n');
  } catch (err) {
    console.log(`Startbar: could not save order.json: ${err.message}`);
  }
  for (const fn of listeners) fn(saved);
}

// The task state with the saved order added, for the bars.
const withOrder = (state) => ({ ...state, order: get() });

function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

module.exports = { get, set, merge, withOrder, onChange };
