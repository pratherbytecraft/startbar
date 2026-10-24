// Checks the npm registry for a newer Startbar. It only checks: updating is
// `npm install -g startbar`, which the person runs themselves.
import { net } from 'electron';
import { EventEmitter } from 'events';
import type { UpdateStatus } from '../shared/types';

const LATEST = 'https://registry.npmjs.org/startbar/latest';
const FIRST_CHECK = 15 * 1000; // after launch, so it doesn't slow startup
const EVERY = 6 * 60 * 60 * 1000;

const events = new EventEmitter();
// state: idle | checking | current | available | failed. latest: the version on npm.
let status: UpdateStatus = { state: 'idle' };

// Whether version a is newer than b. Plain x.y.z, anything after a dash is ignored.
export function newer(a: string, b: string) {
  const pa = String(a).split('-')[0].split('.').map(Number);
  const pb = String(b).split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

function set(next: UpdateStatus) {
  status = next;
  events.emit('change', status);
}

export async function check(current: string) {
  const before = status;
  set({ state: 'checking' });
  try {
    // Electron's fetch takes the browser's cache option, which Node's
    // RequestInit doesn't list.
    const res = await net.fetch(LATEST, { cache: 'no-store', signal: AbortSignal.timeout(10000) } as RequestInit);
    if (!res.ok) throw new Error(`npm answered ${res.status}`);
    const { version } = (await res.json()) as { version: string };
    set({ state: newer(version, current) ? 'available' : 'current', latest: version });
  } catch (err) {
    console.log(`Startbar: update check failed: ${(err as Error).message}`);
    // A failed check doesn't hide an update that was already found.
    set(before.state === 'available' ? before : { state: 'failed' });
  }
  return status;
}

// Checks soon after launch and every few hours while enabled() says so.
export function schedule(current: string, enabled: () => boolean) {
  const tick = () => enabled() && check(current);
  setTimeout(tick, FIRST_CHECK);
  setInterval(tick, EVERY);
}

export const get = () => status;
export const onChange = (fn: (status: UpdateStatus) => void) => events.on('change', fn);
