// A stand-in for the preload's window.startbar, with the same function
// names (read from src/preload.js). Every function the page calls is noted
// in calls as [name, ...args]. The ones that ask the main
// process for something answer from state and extra, and updateSettings
// merges the patch and sends the new state back, like the main process.
// emit(channel, payload) sends what an on... function listens for
// (onState is 'state', onTasks is 'tasks').
function merge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over;
  const out = { ...base };
  for (const key of Object.keys(over)) {
    const b = base ? base[key] : undefined;
    out[key] = b && typeof b === 'object' && !Array.isArray(b) ? merge(b, over[key]) : over[key];
  }
  return out;
}

export function fakeStartbar(names, state, extra = {}) {
  const calls = [];
  const listeners = {};
  const copy = (x) => JSON.parse(JSON.stringify(x));
  const emit = (channel, payload) => (listeners[channel] || []).forEach((fn) => fn(payload));
  const answers = {
    getState: () => copy(state),
    getTasks: () => extra.tasks || { accessibility: true, apps: [] },
    getStatus: () => extra.status || { volume: { level: 0.5, muted: false, settable: true }, wifi: null, battery: null, bluetooth: null, access: {} },
    taskIcons: () => ({}),
    apps: () => extra.apps || [],
    recent: () => extra.recent || [],
    searchFiles: () => extra.files || [],
    placeIcons: () => ({}),
    userPicture: () => '',
    taskCommand: () => ({ ok: true }),
    updateSettings: (patch) => {
      state.settings = merge(state.settings, patch);
      setTimeout(() => emit('state', copy(state)));
      return copy(state.settings);
    }
  };
  const api = { calls, emit, state };
  for (const name of names) {
    if (/^on[A-Z]/.test(name)) {
      const channel = name[2].toLowerCase() + name.slice(3);
      api[name] = (fn) => {
        (listeners[channel] = listeners[channel] || []).push(fn);
        return () => {};
      };
    } else {
      api[name] = (...args) => {
        calls.push([name, ...args]);
        return name in answers ? Promise.resolve(answers[name](...args)) : undefined;
      };
    }
  }
  return api;
}
