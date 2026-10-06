import { useSyncExternalStore } from "react";
import { SETTINGS_CHANGED } from "./host.ts";

let version = 0;

function subscribe(onChange: () => void): () => void {
  const changed = () => {
    version++;
    onChange();
  };
  window.addEventListener(SETTINGS_CHANGED, changed);
  return () => window.removeEventListener(SETTINGS_CHANGED, changed);
}

/** The host's settings object, read again whenever the host announces a change. */
export function useSettingsHost(): unknown {
  useSyncExternalStore(subscribe, () => version);
  return window.feedkeeperSettings;
}
