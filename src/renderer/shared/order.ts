// The order of the bar's buttons once some were dragged around. Each button
// has a key: an app's group, or its button when it has no windows, is the
// app ('app:' and its bundle id), and a window's button is the window
// ('win:' and its id). The saved order is a list of keys, kept by
// main/order.ts. Shared by the bar and the unit tests.
(function () {
  const appKey = (app: NonNullable<OrderItem['app']>) => 'app:' + (app.bundleId || app.path || app.name || '');
  // Only asked about buttons with an app, and a window's button has its window.
  const keyOf = (item: OrderItem) => (item.kind === 'window' ? 'win:' + item.win!.id : appKey(item.app!));

  // The keys to save for the buttons in this order. A window also marks
  // where its app is, at the app's first button, so the app's other and
  // future windows know where they belong.
  function orderKeys(items: OrderItem[]) {
    const out: string[] = [];
    const apps = new Set<string>();
    for (const item of items) {
      if (!item.app) continue;
      const app = appKey(item.app);
      if (!apps.has(app)) {
        apps.add(app);
        out.push(app);
      }
      if (item.kind === 'window') out.push(keyOf(item));
    }
    return out;
  }

  // items in the saved order. A button whose key isn't saved goes right
  // after the last saved button of its app, or after the app's own place,
  // and one of an app that isn't saved at all goes at the end. Buttons that
  // land on the same spot keep the order they came in.
  function byOrder<I extends OrderItem>(items: I[], order: string[] | undefined) {
    if (!order || !order.length) return items;
    const at = new Map(order.map((k, i) => [k, i] as const));
    const last = new Map<string, number>(); // app key -> the furthest saved spot of its buttons
    // A spot not noted yet compares as undefined, which is never >= i.
    const note = (app: string, i: number | undefined) => { if (i !== undefined && !((last.get(app) as number) >= i)) last.set(app, i); };
    for (const item of items) {
      if (!item.app) continue;
      note(appKey(item.app), at.get(appKey(item.app)));
      note(appKey(item.app), at.get(keyOf(item)));
    }
    const rank = (item: I) => {
      if (!item.app) return Infinity;
      const own = at.get(keyOf(item));
      if (own !== undefined) return own;
      const app = last.get(appKey(item.app));
      return app !== undefined ? app + 0.5 : Infinity;
    };
    return items.map((item, i) => ({ item, i, r: rank(item) }))
      .sort((x, y) => (x.r === y.r ? x.i - y.i : x.r < y.r ? -1 : 1))
      .map((x) => x.item);
  }

  window.byOrder = byOrder;
  window.orderKeys = orderKeys;
  window.orderKey = keyOf;
})();
