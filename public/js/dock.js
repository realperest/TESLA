/**
 * macOS Dock — Büyütme efekti
 * İkonlar sadece yukarı kalkar, yan yana itmez
 */
(function () {
  const MAX_SCALE = 1.35;
  const RANGE     = 70;   // px etki yarıçapı

  let items = [];

  function init() {
    const dock = document.getElementById('dock');
    if (!dock) return;
    items = Array.from(dock.querySelectorAll('.dock-item'));

    dock.addEventListener('mousemove', onMove);
    dock.addEventListener('mouseleave', onLeave);
  }

  function onMove(e) {
    const mx = e.clientX;
    items.forEach(item => {
      const rect   = item.getBoundingClientRect();
      const center = rect.left + rect.width / 2;
      const dist   = Math.abs(mx - center);
      const t      = Math.max(0, 1 - dist / RANGE);
      // ease: smooth step
      const ease   = t * t * (3 - 2 * t);
      const scale  = 1 + (MAX_SCALE - 1) * ease;
      const lift   = (scale - 1) * 32;

      item.style.transform        = `translateY(-${lift.toFixed(1)}px) scale(${scale.toFixed(3)})`;
      item.style.transitionDuration = dist < RANGE ? '0.12s' : '0.22s';
      item.style.transitionTimingFunction = 'cubic-bezier(0.34,1.4,0.64,1)';
    });
  }

  function onLeave() {
    items.forEach(item => {
      item.style.transitionDuration = '0.25s';
      item.style.transform = '';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
