// The real Dock. It shares the bottom edge with the bar, so the Taskbar
// settings page shows whether it hides itself and offers to hide it. Uses
// the same setting as "Automatically hide and show the Dock".
import { execFile } from 'child_process';
import type { DockStatus } from '../shared/types';

// How a change through System Events went.
export type DockResult = 'ok' | 'notAllowed' | 'failed';

function run(cmd: string, args: string[]) {
  return new Promise<string | null>((resolve) => {
    execFile(cmd, args, (err, stdout) => resolve(err ? null : String(stdout).trim()));
  });
}

// "Not authorized to send Apple events", the Automation permission was turned down.
const NOT_ALLOWED = -1743;

// { autohide: true or false, position: bottom | left | right }
export async function status(): Promise<DockStatus> {
  const [autohide, orientation] = await Promise.all([
    run('defaults', ['read', 'com.apple.dock', 'autohide']),
    run('defaults', ['read', 'com.apple.dock', 'orientation'])
  ]);
  return { autohide: autohide === '1', position: orientation || 'bottom' };
}

// macOS asks once whether Startbar may control System Events. Resolves to
// ok, notAllowed or failed.
function tellSystemEvents(command: string) {
  return new Promise<DockResult>((resolve) => {
    execFile('osascript', ['-e', `tell application "System Events" to ${command}`], (err, _out, stderr) => {
      if (!err) return resolve('ok');
      resolve(String(stderr).includes(String(NOT_ALLOWED)) ? 'notAllowed' : 'failed');
    });
  });
}

// Through System Events, the way the switch in System Settings does it.
// Writing the setting and restarting the Dock instead leaves the bar pushed
// up off the bottom edge.
export function setAutohide(on: boolean) {
  return tellSystemEvents(`set autohide of dock preferences to ${on}`);
}

// Minimized windows shrink toward the Dock, so on a side they fly off to
// that side instead of down toward the bar.
export function moveToBottom() {
  return tellSystemEvents('set screen edge of dock preferences to bottom');
}

// Only reads, so the Permissions page can ask without changing anything.
export function askAutomation() {
  return tellSystemEvents('get autohide of dock preferences');
}

