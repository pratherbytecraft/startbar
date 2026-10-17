// Runs startbar-helper in one of its modes for a test file. Each JSON line it
// prints is kept, send() writes a command and waits for its reply, and
// waitFor() waits for a line that passes a check. Build the helper first
// (npm run test:helper does).
const { spawn } = require('child_process');
const readline = require('readline');
const { helperPath } = require('../../scripts/build-helper');

function run(...args) {
  const bin = helperPath();
  if (!bin) throw new Error('the helper is not built, run npm run test:helper');
  const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = [];
  const waiting = new Set();
  let seq = 0;
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line);
    lines.push(msg);
    for (const w of waiting) w(msg);
  });
  function waitFor(check, timeout = 5000) {
    const seen = lines.find(check);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.delete(w);
        reject(new Error('the helper never sent what the test waited for'));
      }, timeout);
      const w = (msg) => {
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
    waitForNext(check, timeout) {
      lines.length = 0;
      return waitFor(check, timeout);
    },
    write: (line) => child.stdin.write(line + '\n'),
    send(command) {
      const id = ++seq;
      child.stdin.write(JSON.stringify({ ...command, seq: id }) + '\n');
      return waitFor((m) => m.type === 'reply' && m.seq === id);
    },
    stop: () => child.kill()
  };
}

module.exports = { run };
