// The real Dock. It shares the bottom edge with the bar, so the Taskbar
// settings page shows whether it hides itself and offers to hide it. Uses
// the same setting as "Automatically hide and show the Dock".
const { execFile } = require('child_process');

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, (err, stdout) => resolve(err ? null : String(stdout).trim()));
  });
}

// "Not authorized to send Apple events", the Automation permission was turned down.
const NOT_ALLOWED = -1743;

// { autohide: true or false, position: bottom | left | right }
async function status() {
  const [autohide, orientation] = await Promise.all([
    run('defaults', ['read', 'com.apple.dock', 'autohide']),
    run('defaults', ['read', 'com.apple.dock', 'orientation'])
  ]);
  return { autohide: autohide === '1', position: orientation || 'bottom' };
}

// Through System Events, the way the switch in System Settings does it.
// Writing the setting and restarting the Dock instead leaves the bar pushed
// up off the bottom edge. macOS asks once whether Startbar may control
// System Events. Resolves to ok, notAllowed or failed.
function setAutohide(on) {
  const script = `tell application "System Events" to set autohide of dock preferences to ${on}`;
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], (err, _out, stderr) => {
      if (!err) return resolve('ok');
      resolve(String(stderr).includes(String(NOT_ALLOWED)) ? 'notAllowed' : 'failed');
    });
  });
}

module.exports = { status, setAutohide };
