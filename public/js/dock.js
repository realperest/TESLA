(function () {
  function init() {
    const badge = document.getElementById('app-version-badge');
    if (!badge) return;
    const ver = badge.dataset.version;
    const key = 'seenAppVersion';
    if (localStorage.getItem(key) !== ver) {
      badge.classList.add('is-new');
      localStorage.setItem(key, ver);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
