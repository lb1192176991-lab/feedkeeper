(function () {
  try {
    var saved = localStorage.getItem("fk_theme");
    if (saved === "light" || saved === "dark") {
      document.documentElement.setAttribute("data-theme", saved);
    }
  } catch {
    // Storage may be unavailable in private browsing.
  }
})();
