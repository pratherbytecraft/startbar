#!/usr/bin/env node
// Launches Startbar. `startbar` starts it in the background and returns.
// `startbar --foreground` keeps it attached to the terminal so its log shows.
const { spawn } = require('child_process');
const path = require('path');

if (process.platform !== 'darwin') {
  console.error('Startbar runs on macOS only.');
  process.exit(1);
}

const electron = require('electron'); // the path to the Electron binary when required from Node
const appDir = path.join(__dirname, '..');
const args = process.argv.slice(2);
const foreground = args.includes('--foreground');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [appDir, ...args], {
  detached: !foreground,
  stdio: foreground ? 'inherit' : 'ignore',
  env
});

if (foreground) {
  child.on('exit', (code) => process.exit(code ?? 0));
} else {
  child.unref();
  console.log('Startbar is running. Quit it from the Start menu, About Startbar, Quit.');
}
