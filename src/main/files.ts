// Home folder search for the Start menu, through Spotlight (mdfind). Only
// one search runs at a time; a new one stops the last.
import { spawn, type ChildProcess } from 'child_process';
import os from 'os';
import path from 'path';
import readline from 'readline';
import type { FileHit } from '../shared/types';

const SHOWN = 8; // results in the menu
const READ = 80; // lines read from mdfind before it's stopped

let child: ChildProcess | null = null;

// Hidden folders, ~/Library, app bundles and node_modules are noise here.
function keep(file: string, home: string) {
  const rel = path.relative(home, file);
  if (!rel || rel.startsWith('..')) return false;
  const parts = rel.split(path.sep);
  if (parts[0] === 'Library') return false;
  return !parts.some((p) => p.startsWith('.') || p.endsWith('.app') || p === 'node_modules');
}

// Names that start with the search first, then shallower paths.
function rank(list: string[], q: string) {
  const lower = q.toLowerCase();
  const score = (file: string) => (path.basename(file).toLowerCase().startsWith(lower) ? 0 : 1);
  const depth = (file: string) => file.split(path.sep).length;
  return list.sort((a, b) => score(a) - score(b) || depth(a) - depth(b) || a.localeCompare(b));
}

// Resolves to [{ path, name, where }], where is the folder it's in, as ~/...
export function search(query: string): Promise<Omit<FileHit, 'icon'>[]> {
  if (child) child.kill();
  child = null;
  const q = String(query || '').trim();
  if (q.length < 2) return Promise.resolve([]);
  const home = os.homedir();
  return new Promise((resolve) => {
    const found: string[] = [];
    const proc = spawn('mdfind', ['-onlyin', home, '-name', q]);
    child = proc;
    readline.createInterface({ input: proc.stdout }).on('line', (line) => {
      if (keep(line, home)) found.push(line);
      if (found.length >= READ) proc.kill();
    });
    proc.on('error', () => resolve([]));
    proc.on('close', () => {
      if (child === proc) child = null;
      resolve(rank(found, q).slice(0, SHOWN).map((file) => {
        const dir = path.relative(home, path.dirname(file));
        return { path: file, name: path.basename(file), where: dir ? '~/' + dir : '~' };
      }));
    });
  });
}

