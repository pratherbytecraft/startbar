// Runs startbar-helper in one of its modes for a test file. Each JSON line it
// prints is kept, send() writes a command and waits for its reply, and
// waitFor() waits for a line that passes a check. Build the helper first
// (npm run test:helper does).
import { spawn } from 'child_process';
import readline from 'readline';
import { helperPath } from '../../src/scripts/build-helper';
import type { HelperCommand } from '../../src/main/tasks';
import type { HelperReply, Status, TaskApp } from '../../src/shared/types';

// What each mode prints, one JSON object per line.
export type ReplyLine = { type: 'reply' } & HelperReply;
export type IconLine = { path: string; png: string };
export type StatusLine = { type: 'status' } & Status;
export type WindowsLine =
  | { type: 'permission'; accessibility: boolean }
  | { type: 'state'; apps: TaskApp[] }
  | { type: 'click'; x: number; y: number }
  | ReplyLine;

// L is what the mode prints, the window mode's lines unless a test says.
export function run<L extends object = WindowsLine>(...args: string[]) {
  const bin = helperPath();
  if (!bin) throw new Error('the helper is not built, run npm run test:helper');
  const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines: L[] = [];
  const waiting = new Set<(msg: L) => void>();
  let seq = 0;
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const msg: L = JSON.parse(line);
    lines.push(msg);
    for (const w of waiting) w(msg);
  });
  // A check that names the kind of line gives back that kind.
  function waitFor<T extends L>(check: (m: L) => m is T, timeout?: number): Promise<T>;
  function waitFor(check: (m: L) => unknown, timeout?: number): Promise<L>;
  function waitFor(check: (m: L) => unknown, timeout = 5000) {
    const seen = lines.find(check);
    if (seen) return Promise.resolve(seen);
    return new Promise<L>((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.delete(w);
        reject(new Error('the helper never sent what the test waited for'));
      }, timeout);
      const w = (msg: L) => {
        if (!check(msg)) return;
        clearTimeout(timer);
        waiting.delete(w);
        resolve(msg);
      };
      waiting.add(w);
    });
  }
  return {
    lines,
    waitFor,
    // Only lines from now on, for a change the test is about to cause.
    waitForNext(check: (m: L) => unknown, timeout?: number) {
      lines.length = 0;
      return waitFor(check, timeout);
    },
    write: (line: string) => child.stdin.write(line + '\n'),
    send(command: HelperCommand) {
      const id = ++seq;
      child.stdin.write(JSON.stringify({ ...command, seq: id }) + '\n');
      // Only the window mode answers commands, so its lines are the ones to read.
      return waitFor((m) => (m as WindowsLine).type === 'reply' && (m as ReplyLine).seq === id) as Promise<ReplyLine>;
    },
    stop: () => child.kill()
  };
}
