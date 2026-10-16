// Compiles the Swift helper at install time. If swiftc is missing the install
// still succeeds and Startbar runs in a reduced way (icons from Electron,
// no window buttons), with a note in the log on how to get the full set.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'helper', 'startbar-helper.swift');
const out = path.join(root, 'helper', 'startbar-helper');

function helperPath() {
  return fs.existsSync(out) ? out : null;
}

function build({ quiet = false } = {}) {
  if (process.platform !== 'darwin') return null;
  const which = spawnSync('xcrun', ['--find', 'swiftc'], { encoding: 'utf8' });
  if (which.status !== 0) {
    if (!quiet) {
      console.log('Startbar: swiftc was not found, so the helper was not built.');
      console.log('Startbar: install the Command Line Tools with `xcode-select --install`, then run `npm rebuild -g startbar`.');
    }
    return null;
  }
  const res = spawnSync('swiftc', ['-O', '-o', out, src], { encoding: 'utf8' });
  if (res.status !== 0) {
    if (!quiet) console.log('Startbar: the helper did not build.\n' + (res.stderr || res.stdout));
    return null;
  }
  if (!quiet) console.log('Startbar: helper built.');
  return out;
}

if (require.main === module) build();

module.exports = { build, helperPath };
