// The order of the bar's buttons once some were dragged, as keys (see
// renderer/shared/order.ts), saved in order.json next to pins.json. Apps
// keep their place across restarts. Windows are kept by id, which lasts as
// long as the window, so a closed window's key is dropped.
import fs from 'fs';
import path from 'path';
import * as settings from './settings';
import type { Tasks } from '../shared/types';

const MAX = 400;
let saved: string[] | null = null;
const listeners = new Set<(order: string[]) => void>();

function file() {
  return path.join(settings.dataDir(), 'order.json');
}

export function get() {
  if (saved) return saved;
  try {
    const list = JSON.parse(fs.readFileSync(file(), 'utf8'));
    saved = Array.isArray(list) ? list.filter((k: unknown) => typeof k === 'string' && /^(app|win):/.test(k)) : [];
  } catch {
    saved = [];
  }
  return saved;
}

// The keys on the bar now, in their new order, with every saved key that
// isn't on the bar put back after the key it followed before.
export function merge(old: string[], shown: string[]) {
  const on = new Set(shown);
  const out = [...shown];
  let prev: string | null = null;
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
export function set(shown: unknown[], open: string[]) {
  const ids = new Set(open.map(String));
  const keys = shown.filter((k): k is string => typeof k === 'string' && /^(app|win):/.test(k));
  saved = merge(get(), keys).filter((k) => !k.startsWith('win:') || ids.has(k.slice(4))).slice(0, MAX);
  try {
    fs.writeFileSync(file(), JSON.stringify(saved, null, 2) + '\n');
  } catch (err) {
    console.log(`Startbar: could not save order.json: ${(err as Error).message}`);
  }
  for (const fn of listeners) fn(saved);
}

// The task state with the saved order added, for the bars.
export const withOrder = <T extends Tasks>(state: T) => ({ ...state, order: get() });

export function onChange(fn: (order: string[]) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

