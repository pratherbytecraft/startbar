// Drag a window out of the group list or the preview onto the bar, where it
// gets its own button. Pointer capture keeps the events coming after the
// pointer leaves this window (the reorder helper relies on the same), so
// each screen point goes to the main process, which finds the bar under it
// and shows the slot there. A press that moves less than a few pixels stays
// a click, and anything marked .no-drag (the close button) never starts one.
// payload(el) says which window the element is: { id, pid, title, icon }.
(function () {
  const THRESHOLD = 4;

  function dragOut(list, { payload }) {
    const api = window.startbar;
    let press = null;
    let swallowClick = false;

    list.addEventListener('pointerdown', (e) => {
      swallowClick = false;
      if (e.button !== 0 || e.target.closest('.no-drag')) return;
      const el = e.target.closest('[data-id]');
      if (!el || !list.contains(el)) return;
      press = { el, x: e.clientX, y: e.clientY, moved: false };
    });

    list.addEventListener('pointermove', (e) => {
      if (!press) return;
      if (!press.moved) {
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < THRESHOLD) return;
        press.moved = true;
        list.setPointerCapture(e.pointerId);
        press.el.classList.add('lifted');
        api.dragOut({ phase: 'start', x: e.screenX, y: e.screenY, ...payload(press.el) });
      }
      api.dragOut({ phase: 'move', x: e.screenX, y: e.screenY });
    });

    const end = (e) => {
      if (!press) return;
      const { el, moved } = press;
      press = null;
      if (!moved) return;
      el.classList.remove('lifted');
      swallowClick = true; // the click that ends a drag isn't a click
      api.dragOut({ phase: e.type === 'pointerup' ? 'drop' : 'cancel', x: e.screenX, y: e.screenY });
    };
    // Icons are images, and dragging an image starts the browser's own drag,
    // which cancels this one.
    list.addEventListener('dragstart', (e) => e.preventDefault());
    list.addEventListener('pointerup', end);
    list.addEventListener('pointercancel', end);
    list.addEventListener('click', (e) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopPropagation();
      e.preventDefault();
    }, true);
  }

  window.dragOut = dragOut;
})();
