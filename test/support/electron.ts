// A stand-in for Electron in the unit tests, which run in plain Node. It goes
// into Node's module cache under Electron's own name, so a module that
// requires 'electron' after this gets it instead. app.getPath('appData')
// answers with the temp folder from the last tempAppData().
import fs from 'fs';
import Module from 'module';
import os from 'os';
import path from 'path';

const paths: Record<string, string> = {};
const made: string[] = [];

export const app = {
  getPath: (name: string) => {
    if (!paths[name]) throw new Error(`no test path for ${name}, call tempAppData() first`);
    return paths[name];
  }
};

const id = require.resolve('electron');
const stub = new Module(id);
stub.filename = id;
stub.loaded = true;
stub.exports = { app };
require.cache[id] = stub;

// A new empty folder to stand in for ~/Library/Application Support.
export function tempAppData() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'startbar-test-'));
  made.push(dir);
  paths.appData = dir;
  return dir;
}

process.on('exit', () => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});
