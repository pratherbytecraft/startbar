#!/usr/bin/env node
// Launches Startbar. `startbar` starts it in the background and returns.
// `startbar --foreground` keeps it attached to the terminal so its log shows.
//
// Startbar.app is opened through Launch Services (`open`), not run directly,
// so macOS treats it as its own app. Run directly from Terminal, macOS would
// check Terminal's Accessibility permission instead of Startbar's.
const { spawn, spawnSync } = require('child_process');
const path = require('path');

if (process.platform !== 'darwin') {
  console.error('Startbar runs on macOS only.');
  process.exit(1);
}

const { appPath, build, BUNDLE_ID } = require('../scripts/build-app');
const args = process.argv.slice(2);
const foreground = args.includes('--foreground');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

function terminalPath() {
  if (!process.stdin.isTTY) return null;
  const res = spawnSync('tty', { stdio: ['inherit', 'pipe', 'ignore'], encoding: 'utf8' });
  return res.status === 0 ? res.stdout.trim() : null;
}

// Fallback when the bundle wasn't built: plain Electron, shown as Electron.
function runElectron() {
  const electron = require('electron'); // the path to the Electron binary when required from Node
  const child = spawn(electron, [path.join(__dirname, '..'), ...args], {
    detached: !foreground,
    stdio: foreground ? 'inherit' : 'ignore',
    env
  });
  if (foreground) {
    child.on('exit', (code) => process.exit(code ?? 0));
  } else {
    child.unref();
  }
}

function runBundle(bundle) {
  const openArgs = ['-a', bundle];
  const tty = foreground ? terminalPath() : null;
  if (tty) openArgs.unshift('-W', '--stdout', tty, '--stderr', tty);
  if (args.length) openArgs.push('--args', ...args);
  const child = spawn('open', openArgs, { stdio: 'inherit', env });
  if (tty) {
    // Control C quits Startbar too, the way it did when it ran in this terminal.
    process.on('SIGINT', () => {
      spawnSync('osascript', ['-e', `tell application id "${BUNDLE_ID}" to quit`]);
    });
    child.on('exit', (code) => process.exit(code ?? 0));
  } else {
    child.on('exit', (code) => {
      if (code === 0) console.log('Startbar is running. Quit it from the Start menu, About Startbar, Quit.');
      process.exit(code ?? 0);
    });
  }
}

// The install builds Startbar.app, except where it can't write to the home
// folder (Homebrew), or when the app belongs to an older install. Then the
// first run builds it, finishing Electron's install first if it stopped
// partway (see scripts/fix-electron.js).
(async () => {
  let bundle = appPath();
  if (!bundle) {
    console.log('Startbar: setting up Startbar.app, this takes a moment the first time.');
    await require('../scripts/fix-electron').fix({ quiet: true });
    build({ quiet: true });
    bundle = appPath();
  }
  if (bundle) {
    runBundle(bundle);
  } else {
    if (foreground) console.log('Startbar: Startbar.app was not found, running as Electron. Run `npm run build-app` to build it.');
    runElectron();
    if (!foreground) console.log('Startbar is running. Quit it from the Start menu, About Startbar, Quit.');
  }
})();
