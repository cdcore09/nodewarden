// Mockup chrome: theme toggle persisted across pages.
(function () {
  var KEY = 'nx-mock-theme';
  var saved = localStorage.getItem(KEY);
  if (saved === 'dark') document.documentElement.dataset.theme = 'dark';
  window.nxToggleTheme = function () {
    var root = document.documentElement;
    var dark = root.dataset.theme === 'dark';
    if (dark) { delete root.dataset.theme; localStorage.removeItem(KEY); }
    else { root.dataset.theme = 'dark'; localStorage.setItem(KEY, 'dark'); }
  };
})();
