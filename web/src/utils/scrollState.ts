const SCROLL_STORAGE_KEY = "feedkeeper_items_scroll_y";

let itemsScrollY = (() => {
  try {
    return Number(sessionStorage.getItem(SCROLL_STORAGE_KEY) || "0");
  } catch {
    return 0;
  }
})();

export function getItemsScrollY(): number {
  return itemsScrollY;
}

export function setItemsScrollY(y: number) {
  itemsScrollY = Math.max(0, y);
  try {
    sessionStorage.setItem(SCROLL_STORAGE_KEY, String(Math.round(itemsScrollY)));
  } catch {
    // Ignore sessionStorage errors
  }
}

export function resetItemsScrollY() {
  setItemsScrollY(0);
}
