import { useSyncExternalStore } from "react";
import { EXTENSIONS_CHANGED } from "./host.ts";

let version = 0;

function subscribe(onChange: () => void): () => void {
  const changed = () => {
    version++;
    onChange();
  };
  window.addEventListener(EXTENSIONS_CHANGED, changed);
  return () => window.removeEventListener(EXTENSIONS_CHANGED, changed);
}

/** The object a hosting script put on `window.feedkeeperExtensions`, read again whenever it announces a change. */
export function useExtensions(): unknown {
  useSyncExternalStore(subscribe, () => version);
  return window.feedkeeperExtensions;
}
