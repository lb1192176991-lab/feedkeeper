export function isSplashVisible() {
  return document.getElementById("splash")?.classList.contains("splash-hidden") === false;
}

/** Fade out the static splash from index.html once the first real screen is ready. */
export function hideSplash() {
  const splash = document.getElementById("splash");
  if (!splash || splash.classList.contains("splash-hidden")) return;
  splash.classList.add("splash-hidden");
  const remove = () => splash.remove();
  splash.addEventListener("transitionend", remove, { once: true });
  // Fallback when no transition runs (reduced motion, background tab).
  window.setTimeout(remove, 500);
}
