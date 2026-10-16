// Drag to reorder the children of a list with the mouse. Each child that can
// move carries a data-key. A press that moves less than a few pixels stays a
// click, and anything marked .no-drag (a Remove button) never starts a drag.
// onDrop gets the keys in their new order.
(function () {
  const THRESHOLD = 4;

  function reorderable(list, { axis = 'x', onStart, onDrop }) {
    let press = null;
    let swallowClick = false;

    list.addEventListener('pointerdown', (e) => {
      swallowClick = false;
      if (e.button !== 0 || e.target.closest('.no-drag')) return;
      const item = e.target.closest('[data-key]');
      if (!item || item.parentElement !== list) return;
      press = { item, x: e.clientX, y: e.clientY, moved: false };
    });

    list.addEventListener('pointermove', (e) => {
      if (!press) return;
      if (!press.moved) {
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < THRESHOLD) return;
        press.moved = true;
        list.setPointerCapture(e.pointerId);
        press.item.classList.add('dragging');
        list.classList.add('reordering');
        if (onStart) onStart();
      }
      const pos = axis === 'x' ? e.clientX : e.clientY;
      const others = [...list.children].filter((c) => c !== press.item && c.dataset.key);
      const before = others.find((c) => {
        const r = c.getBoundingClientRect();
        return pos < (axis === 'x' ? r.left + r.width / 2 : r.top + r.height / 2);
      });
      if (before) {
        if (press.item.nextElementSibling !== before) list.insertBefore(press.item, before);
      } else if (others.length && press.item.previousElementSibling !== others[others.length - 1]) {
        others[others.length - 1].after(press.item);
      }
    });

    const end = () => {
      if (!press) return;
      const { item, moved } = press;
      press = null;
      if (!moved) return;
      item.classList.remove('dragging');
      list.classList.remove('reordering');
      swallowClick = true; // the click that ends a drag isn't a click
      onDrop([...list.children].map((c) => c.dataset.key).filter(Boolean));
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

  window.reorderable = reorderable;
})();
