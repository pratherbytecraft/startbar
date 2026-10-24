// The running apps and their windows, from `startbar-helper windows`.
// Keeps the latest list, sends window commands, and restarts the helper if
// it stops. The bar draws its buttons from this list.
import { spawn, type ChildProcessByStdio } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import type { Readable, Writable } from 'stream';
import { helperPath } from '../scripts/build-helper';
import type { HelperReply, Point, TaskApp, TaskCommand, Tasks } from '../shared/types';

// One area per bar for keepOff: the bottom of the menu bar, the top of the
// bar, and the screen it's on.
export interface KeepOffArea {
  top: number;
  bottom: number;
  screen: { x: number; y: number; w: number; h: number };
}

// What main sends the helper, the pages' commands and its own. See the list
// at the top of WindowWatcher in helper/startbar-helper.swift.
export type HelperCommand =
  | TaskCommand
  | { cmd: 'unpeek' | 'askScreen' | 'refresh' }
  | { cmd: 'thumb'; id: string; width: number; height: number }
  | { cmd: 'hasWindows'; pid: number; ids: string[] }
  | { cmd: 'keepOff'; areas: KeepOffArea[] }
  | { cmd: 'spaces'; all: boolean }
  | { cmd: 'watchClicks' | 'clickThrough'; on: boolean }
  | { cmd: 'postClick'; x: number; y: number };

// What the helper prints, one JSON object per line.
type HelperMessage =
  | { type: 'permission'; accessibility: boolean }
  | { type: 'state'; apps: TaskApp[] }
  | { type: 'click'; x: number; y: number }
  | ({ type: 'reply' } & HelperReply);

const events = new EventEmitter();
const pending = new Map<number, (reply: HelperReply) => void>(); // seq -> resolve
let child: ChildProcessByStdio<Writable, Readable, null> | null = null;
let stopping = false;
let restarts = 0;
let relaunch = false;
let seq = 0;
let state: Tasks = { accessibility: null, apps: [] };
let keepOff: { cmd: 'keepOff'; areas: KeepOffArea[] } = { cmd: 'keepOff', areas: [] }; // resent to every new helper
let spaces = { cmd: 'spaces' as const, all: false }; // this one too
let watchClicks = { cmd: 'watchClicks' as const, on: false }; // and this one
let clickThrough = { cmd: 'clickThrough' as const, on: false }; // and this one
let rawApps: TaskApp[] = []; // the helper's list, before held back Finder windows come out

// Apps that /Applications only links to (Safari, which lives in a system
// folder since macOS 13) come from the helper at their real path. They're
// given the link's path, the one the Start menu and the pins use.
let links: Map<string, string> | null = null;
function linkedApps() {
  if (links) return links;
  links = new Map();
  try {
    for (const name of fs.readdirSync('/Applications')) {
      if (!name.endsWith('.app')) continue;
      const p = path.join('/Applications', name);
      try {
        if (fs.lstatSync(p).isSymbolicLink()) links.set(fs.realpathSync(p), p);
      } catch {}
    }
  } catch {}
  return links;
}

function update(patch: Partial<Tasks>) {
  state = { ...state, ...patch };
  events.emit('change', state);
}

function onLine(line: string) {
  let msg: HelperMessage;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.type === 'permission') {
    const wasOff = state.accessibility === false;
    if (msg.accessibility !== state.accessibility) {
      console.log(`Startbar: Accessibility permission ${msg.accessibility ? 'on' : 'off'}.`);
    }
    update({ accessibility: !!msg.accessibility });
    // Granted while running. A fresh helper starts with the permission in
    // place instead of relying on a process that began without it.
    if (wasOff && msg.accessibility) restart();
  } else if (msg.type === 'state') {
    rawApps = msg.apps.map((a) => (linkedApps().has(a.path) ? { ...a, path: linkedApps().get(a.path)! } : a));
    update({ apps: heldBack(rawApps) });
  } else if (msg.type === 'click') {
    events.emit('click', { x: Number(msg.x) || 0, y: Number(msg.y) || 0 });
  } else if (msg.type === 'reply') {
    // A reply without a seq finds nothing.
    const resolve = pending.get(msg.seq as number);
    if (resolve) {
      pending.delete(msg.seq as number);
      resolve(msg);
    }
  }
}

export function start() {
  const helper = helperPath();
  if (!helper) {
    console.log('Startbar: the helper is missing, so the bar has no window buttons.');
    return;
  }
  stopping = false;
  const startedAt = Date.now();
  child = spawn(helper, ['windows'], { stdio: ['pipe', 'pipe', 'inherit'] });
  readline.createInterface({ input: child.stdout }).on('line', onLine);
  child.stdin.write(JSON.stringify(keepOff) + '\n');
  child.stdin.write(JSON.stringify(spaces) + '\n');
  if (watchClicks.on) child.stdin.write(JSON.stringify(watchClicks) + '\n');
  if (clickThrough.on) child.stdin.write(JSON.stringify(clickThrough) + '\n');
  child.on('error', (err) => console.log(`Startbar: the window helper did not start: ${err.message}`));
  child.on('exit', (code, signal) => {
    child = null;
    for (const resolve of pending.values()) resolve({ ok: false, error: 'the helper stopped' });
    pending.clear();
    if (stopping) return;
    if (relaunch) {
      relaunch = false;
      restarts = 0;
      return start();
    }
    // Back off if it keeps dying, up to half a minute between tries.
    restarts = Date.now() - startedAt > 60000 ? 0 : restarts + 1;
    const delay = Math.min(30000, 1000 * 2 ** restarts);
    console.log(`Startbar: the window helper stopped (${signal || code}), starting it again in ${delay / 1000}s.`);
    setTimeout(() => stopping || start(), delay);
  });
}

export function restart() {
  if (!child) return;
  relaunch = true;
  child.kill();
}

// While Filedrawer opens Finder's folder windows as its own, a new Finder
// window's button waits a second. The windows Filedrawer takes over close
// before then and never flash on the bar; the ones it leaves to Finder show.
const HOLD = 1000;
let holdFinder: (apps: TaskApp[]) => boolean = () => false;
const finderSeen = new Map<string, number>(); // window id -> when it was first listed
let firstList = true;
let holdTimer: NodeJS.Timeout | undefined;

// Exported for the tests.
export function heldBack(apps: TaskApp[]): TaskApp[] {
  const now = Date.now();
  const finder = apps.find((a) => a.bundleId === 'com.apple.finder');
  const ids = new Set<string>();
  for (const w of finder ? finder.windows : []) {
    ids.add(w.id);
    // The windows open when Startbar starts aren't new.
    if (!finderSeen.has(w.id)) finderSeen.set(w.id, firstList ? 0 : now);
  }
  for (const id of finderSeen.keys()) if (!ids.has(id)) finderSeen.delete(id);
  firstList = false;
  if (!finder || !holdFinder(apps)) return apps;
  // Every window of finder was put in finderSeen above.
  const young = finder.windows.filter((w) => now - finderSeen.get(w.id)! < HOLD);
  if (!young.length) return apps;
  const oldest = Math.max(...young.map((w) => now - finderSeen.get(w.id)!));
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => update({ apps: heldBack(rawApps) }), HOLD - oldest + 20);
  return apps.map((a) => (a === finder ? { ...a, windows: a.windows.filter((w) => !young.includes(w)) } : a));
}

// fn(apps) says whether new Finder windows are held back right now.
export function setHoldFinder(fn: (apps: TaskApp[]) => boolean) {
  holdFinder = fn;
}

export function stop() {
  stopping = true;
  if (child) child.kill();
}

// Sends one command, for example { cmd: 'activate', id: 'w123' } or
// { cmd: 'quitApp', pid: 501 }. Resolves to the helper's reply.
export function send(command: HelperCommand) {
  return new Promise<HelperReply>((resolve) => {
    if (!child) return resolve({ ok: false, error: 'the helper is not running' });
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, error: 'no answer from the helper' });
    }, 5000);
    pending.set(id, (reply) => {
      clearTimeout(timer);
      resolve(reply);
    });
    child.stdin.write(JSON.stringify({ ...command, seq: id }) + '\n');
  });
}

// Where the bars are, so the helper can move windows up off them, one area
// per bar. An empty list stops it, for example while the bar is hidden or
// the setting is off.
export function setKeepOff(areas: KeepOffArea[]) {
  keepOff = { cmd: 'keepOff', areas: areas || [] };
  if (child) send(keepOff);
}

// Whether the helper also lists windows on other Spaces.
export function setSpaces(all: boolean) {
  if (spaces.all === !!all) return;
  spaces = { cmd: 'spaces', all: !!all };
  if (child) send(spaces);
}

// Whether the helper reports every mouse down anywhere, see onClick. Used
// while a preview is pinned open, to close it on a click elsewhere.
export function setWatchClicks(on: boolean) {
  if (watchClicks.on === !!on) return;
  watchClicks = { cmd: 'watchClicks', on: !!on };
  if (child) send(watchClicks);
}

// Whether a click on a window that isn't in front brings it forward and
// lands as a click. The helper's tap needs Accessibility, so main turns
// this on only while the permission is there.
export function setClickThrough(on: boolean) {
  if (clickThrough.on === !!on) return;
  clickThrough = { cmd: 'clickThrough', on: !!on };
  if (child) send(clickThrough);
}

export const get = () => state;
export const onChange = (fn: (state: Tasks) => void) => events.on('change', fn);
export const onClick = (fn: (point: Point) => void) => events.on('click', fn);
