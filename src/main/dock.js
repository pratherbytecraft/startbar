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

// macOS asks once whether Startbar may control System Events. Resolves to
// ok, notAllowed or failed.
function tellSystemEvents(command) {
  return new Promise((resolve) => {
    execFile('osascript', ['-e', `tell application "System Events" to ${command}`], (err, _out, stderr) => {
      if (!err) return resolve('ok');
      resolve(String(stderr).includes(String(NOT_ALLOWED)) ? 'notAllowed' : 'failed');
    });
  });
}

// Through System Events, the way the switch in System Settings does it.
// Writing the setting and restarting the Dock instead leaves the bar pushed
// up off the bottom edge.
function setAutohide(on) {
  return tellSystemEvents(`set autohide of dock preferences to ${on}`);
}

// Only reads, so the Permissions page can ask without changing anything.
function askAutomation() {
  return tellSystemEvents('get autohide of dock preferences');
}

module.exports = { status, setAutohide, askAutomation };
