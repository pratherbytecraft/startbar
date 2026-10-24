// Pinned apps, the icons next to the Start button. Saved as a list of app
// paths in ~/Library/Application Support/Startbar/pins.json.
import fs from 'fs';
import path from 'path';
import * as settings from './settings';

// Used until pins.json exists. Apps that aren't installed are left out.
const DEFAULTS = [
  '/System/Library/CoreServices/Finder.app',
  '/Applications/Safari.app',
  '/System/Applications/Utilities/Terminal.app'
];

let list: string[] | null = null;
const listeners = new Set<(pins: string[]) => void>();

function file() {
  return path.join(settings.dataDir(), 'pins.json');
}

export function isApp(p: unknown): p is string {
  return typeof p === 'string' && path.isAbsolute(p) && p.endsWith('.app');
}

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(file(), 'utf8'));
    list = Array.isArray(saved) ? saved.filter(isApp) : [];
  } catch (err) {
    list = (err as NodeJS.ErrnoException).code === 'ENOENT' ? DEFAULTS.filter((p) => fs.existsSync(p)) : [];
  }
}

// The pins in order. An app that has been deleted drops off the bar.
export function get() {
  if (!list) load(); // which sets list
  return list!.filter((p) => fs.existsSync(p));
}

export function has(p: string) {
  return get().includes(p);
}

export function set(next: unknown) {
  list = [...new Set((Array.isArray(next) ? next : []).filter(isApp))];
  fs.writeFileSync(file(), JSON.stringify(list, null, 2) + '\n');
  for (const fn of listeners) fn(get());
}

export function add(...paths: string[]) {
  set([...get(), ...paths]);
}

export function remove(p: string) {
  set(get().filter((x) => x !== p));
}

export function onChange(fn: (pins: string[]) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

