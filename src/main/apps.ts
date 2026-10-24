// The list of installed apps for the Start menu, with icons, plus the
// recently used list. Icons come from the Swift helper, with Electron as the fallback.
import { app } from 'electron';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import * as settings from './settings';
import { helperPath } from '../scripts/build-helper';
import type { AppEntry } from '../shared/types';

const APP_DIRS = [
  '/Applications',
  '/Applications/Utilities',
  path.join(os.homedir(), 'Applications'),
  '/System/Applications',
  '/System/Applications/Utilities'
];

let loading: Promise<AppEntry[]> | null = null;
const iconCache = new Map<string, string>();

function listAppBundles() {
  const seen = new Set<string>();
  const out: { name: string; path: string }[] = [];
  for (const dir of APP_DIRS) {
    let entries: fs.Dirent[] = [];
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
async function electronIcon(appPath: string) {
  try {
    const img = await app.getFileIcon(appPath, { size: 'normal' });
    return img.toDataURL();
  } catch {
    return '';
  }
}

function toDataUrl(pngPath: string) {
  try {
    return 'data:image/png;base64,' + fs.readFileSync(pngPath).toString('base64');
  } catch {
    return '';
  }
}

// Asks the helper for every missing icon in one run. Resolves to a Map of
// app path to data URL.
function helperIcons(paths: string[]): Promise<Map<string, string>> {
  const helper = helperPath();
  if (!helper || paths.length === 0) return Promise.resolve(new Map());
  return new Promise((resolve) => {
    const result = new Map<string, string>();
    const child = spawn(helper, ['icons', path.join(settings.dataDir(), 'icons')]);
    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      try {
        const { path: p, png }: { path: string; png: string } = JSON.parse(line);
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

export async function iconFor(appPath: string) {
  if (iconCache.has(appPath)) return iconCache.get(appPath);
  const fromHelper = await helperIcons([appPath]);
  const url = fromHelper.get(appPath) || (await electronIcon(appPath));
  iconCache.set(appPath, url);
  return url;
}

// Each item with its icon added, as a data URL, '' when there's none.
async function withIcons<T extends { path: string }>(list: T[]): Promise<(T & { icon: string })[]> {
  const missing = list.filter((a) => !iconCache.has(a.path)).map((a) => a.path);
  const fromHelper = await helperIcons(missing);
  const out: (T & { icon: string })[] = [];
  for (const a of list) {
    if (!iconCache.has(a.path)) {
      iconCache.set(a.path, fromHelper.get(a.path) || (await electronIcon(a.path)));
    }
    out.push({ ...a, icon: iconCache.get(a.path)! }); // set just above
  }
  return out;
}

// Icons for the running apps on the bar, as { path: data URL }.
export async function icons(paths: string[]): Promise<Record<string, string>> {
  const list = await withIcons(paths.filter(Boolean).map((p) => ({ path: p })));
  return Object.fromEntries(list.map((a) => [a.path, a.icon]));
}

// The folders are read again each time, so an app installed or removed
// since the last time shows up or goes away. Only a new app's icon is drawn.
export function load() {
  if (loading) return loading;
  loading = withIcons(listAppBundles()).then((list) => {
    loading = null;
    return list;
  });
  return loading;
}

// Recent apps: most recently launched first.
function recentFile() {
  return path.join(settings.dataDir(), 'recent.json');
}

function readRecent(): string[] {
  try {
    const list = JSON.parse(fs.readFileSync(recentFile(), 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function noteLaunch(appPath: string) {
  const list = readRecent().filter((p) => p !== appPath);
  list.unshift(appPath);
  fs.writeFileSync(recentFile(), JSON.stringify(list.slice(0, 30), null, 2) + '\n');
}

export function forgetRecent(appPath: string) {
  fs.writeFileSync(recentFile(), JSON.stringify(readRecent().filter((p) => p !== appPath), null, 2) + '\n');
}

export async function recent(count: number) {
  const all = await load();
  const byPath = new Map(all.map((a) => [a.path, a]));
  // filter(Boolean) drops the apps that aren't installed any more.
  return (readRecent()
    .map((p) => byPath.get(p))
    .filter(Boolean) as AppEntry[])
    .slice(0, count);
}

