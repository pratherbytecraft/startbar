// Stand-ins for setTimeout, clearTimeout and Date.now, for code that waits.
// Nothing runs until advance() moves the clock past it. restore() puts the
// real ones back.
function install() {
  const real = { setTimeout: global.setTimeout, clearTimeout: global.clearTimeout, now: Date.now };
  let now = 1_000_000;
  let next = 0;
  const queue = new Map(); // id -> { fn, at }
  global.setTimeout = (fn, ms = 0) => {
    queue.set(++next, { fn, at: now + ms });
    return next;
  };
  global.clearTimeout = (id) => queue.delete(id);
  Date.now = () => now;
  return {
    // Moves the clock on, runs what came due in order, then lets promises settle.
    async advance(ms) {
      now += ms;
      const due = [...queue].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at);
      for (const [id, t] of due) {
        queue.delete(id);
        t.fn();
      }
      await new Promise((resolve) => setImmediate(resolve));
    },
    restore() {
      global.setTimeout = real.setTimeout;
      global.clearTimeout = real.clearTimeout;
      Date.now = real.now;
    }
  };
}

module.exports = { install };
