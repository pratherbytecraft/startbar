// Loads the renderer's shared scripts, which attach their functions to
// window, into a fresh sandbox and returns that window. They're TypeScript,
// so this reads the built ones in dist (npm test builds first). Objects made
// in the sandbox have its own prototypes, so compare them through plain().
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SHARED = path.join(__dirname, '..', '..', 'dist', 'renderer', 'shared');

function load(...names) {
  const window = {};
  // theme.js listens on the document as it loads; nothing else needs it here.
  const context = vm.createContext({ window, document: { addEventListener() {} } });
  for (const name of names) vm.runInContext(fs.readFileSync(path.join(SHARED, name), 'utf8'), context, { filename: name });
  return window;
}

const plain = (value) => JSON.parse(JSON.stringify(value));

module.exports = { load, plain };
