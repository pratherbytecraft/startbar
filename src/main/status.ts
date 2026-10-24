// Volume, Wi-Fi, battery and Bluetooth for the tray, from `startbar-helper
// status`, and where the Location, Bluetooth and Automation permissions
// stand. Keeps the latest reading, sends changes, and restarts the helper if
// it stops. Missing pieces (no Wi-Fi, no battery, Bluetooth not allowed)
// come through as null.
import { spawn, type ChildProcessByStdio } from 'child_process';
import { EventEmitter } from 'events';
import readline from 'readline';
import type { Readable, Writable } from 'stream';
import { statusHelperPath } from '../scripts/build-helper';
import type { Status, TrayCommand } from '../shared/types';

// What main sends the status helper: the tray's commands and its own.
export type StatusCommand = TrayCommand | { cmd: 'access' | 'askLocation' | 'askBluetooth' | 'refresh' };

// What the helper prints, one JSON object per line. Its reply to each
// command comes too, and is skipped: the new reading is what counts.
type StatusMessage = ({ type: 'status' } & Omit<Status, 'access'> & { access?: Status['access'] }) | { type: 'reply'; ok: boolean; error?: string };

const events = new EventEmitter();
let child: ChildProcessByStdio<Writable, Readable, null> | null = null;
let stopping = false;
let restarts = 0;
let status: Status = { volume: null, wifi: null, battery: null, bluetooth: null, access: {} };

function onLine(line: string) {
  let msg: StatusMessage;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.type !== 'status') return;
  status = { volume: msg.volume, wifi: msg.wifi, battery: msg.battery, bluetooth: msg.bluetooth, access: msg.access || {} };
  events.emit('change', status);
}

export function start() {
  const helper = statusHelperPath();
  if (!helper) return;
  stopping = false;
  const startedAt = Date.now();
  child = spawn(helper, ['status'], { stdio: ['pipe', 'pipe', 'inherit'] });
  readline.createInterface({ input: child.stdout }).on('line', onLine);
  child.on('error', (err) => console.log(`Startbar: the tray helper did not start: ${err.message}`));
  child.on('exit', (code, signal) => {
    child = null;
    if (stopping) return;
    restarts = Date.now() - startedAt > 60000 ? 0 : restarts + 1;
    const delay = Math.min(30000, 1000 * 2 ** restarts);
    console.log(`Startbar: the tray helper stopped (${signal || code}), starting it again in ${delay / 1000}s.`);
    setTimeout(() => stopping || start(), delay);
  });
}

export function stop() {
  stopping = true;
  if (child) child.kill();
}

// { cmd: 'setVolume', level: 0.4 }, { cmd: 'setMuted', muted: true },
// { cmd: 'setWifi', on: false }, { cmd: 'askLocation' } and the like. The new
// reading comes back as a change.
export function send(command: StatusCommand) {
  if (child) child.stdin.write(JSON.stringify(command) + '\n');
}

export const get = () => status;
export const onChange = (fn: (status: Status) => void) => events.on('change', fn);
