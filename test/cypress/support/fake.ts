// A stand-in for the preload's window.startbar, with the same function
// names (read from src/preload.ts). Every function the page calls is noted
// in calls as [name, ...args]. The ones that ask the main
// process for something answer from state and extra, and updateSettings
// merges the patch and sends the new state back, like the main process.
// emit(channel, payload) sends what an on... function listens for
// (onState is 'state', onTasks is 'tasks').
import type { AppEntry, FileHit, Settings, SettingsPatch, StartbarApi, State, Status, Tasks, TaskState } from '../../../src/shared/types';

export type Fake = StartbarApi & {
  calls: unknown[][];
  emit: (channel: string, payload?: unknown) => void;
  state: State;
};

// What the getters answer with besides the state. A test's window list can
// leave out the pulled out windows and the order.
export interface Extra {
  tasks?: Tasks & Partial<TaskState>;
  status?: Status;
  apps?: AppEntry[];
  recent?: AppEntry[];
  files?: FileHit[];
}

type Listener = (payload: unknown) => void;

// merge walks plain objects key by key.
type Obj = Record<string, unknown>;

function merge(base: object | undefined, over: unknown): unknown {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over;
  const out: Obj = { ...base };
  for (const key of Object.keys(over)) {
    const b = base ? (base as Obj)[key] : undefined;
    out[key] = b && typeof b === 'object' && !Array.isArray(b) ? merge(b, (over as Obj)[key]) : (over as Obj)[key];
  }
  return out;
}

export function fakeStartbar(names: string[], state: State, extra: Extra = {}): Fake {
  const calls: unknown[][] = [];
  const listeners: Record<string, Listener[]> = {};
  const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));
  const emit = (channel: string, payload?: unknown) => (listeners[channel] || []).forEach((fn) => fn(payload));
  const answers: { [K in keyof StartbarApi]?: (...args: Parameters<StartbarApi[K]>) => unknown } = {
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
    updateSettings: (patch: SettingsPatch) => {
      state.settings = merge(state.settings, patch) as Settings;
      setTimeout(() => emit('state', copy(state)));
      return copy(state.settings);
    }
  };
  const api: Record<string, unknown> = { calls, emit, state };
  for (const name of names) {
    if (/^on[A-Z]/.test(name)) {
      const channel = name[2].toLowerCase() + name.slice(3);
      api[name] = (fn: Listener) => {
        (listeners[channel] = listeners[channel] || []).push(fn);
        return () => {};
      };
    } else {
      api[name] = (...args: unknown[]) => {
        calls.push([name, ...args]);
        // The page passes what the function's own parameters say.
        return name in answers ? Promise.resolve((answers[name as keyof StartbarApi] as (...a: unknown[]) => unknown)(...args)) : undefined;
      };
    }
  }
  return api as unknown as Fake;
}
