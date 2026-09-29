/** Chromium's install prompt event; not part of the standard DOM typings. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallMode = "installed" | "prompt" | "ios" | "mac-safari" | "unsupported";

export interface InstallEnvironment {
  standalone: boolean;
  hasPrompt: boolean;
  userAgent: string;
  maxTouchPoints: number;
}

/** Decide how the app can be added to the home screen in the current browser. */
export function installMode({ standalone, hasPrompt, userAgent, maxTouchPoints }: InstallEnvironment): InstallMode {
  if (standalone) return "installed";
  if (hasPrompt) return "prompt";
  // iPadOS reports a Mac user agent, so touch support identifies it.
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  if (ios) return "ios";
  const safari = /Safari\//.test(userAgent) && !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR|Firefox/.test(userAgent);
  if (/Macintosh/.test(userAgent) && safari) return "mac-safari";
  return "unsupported";
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

/** Capture the install prompt early; Chromium fires it once, often before the settings page mounts. */
export function captureInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installed = true;
    notify();
  });
}

export function subscribeInstallPrompt(listener: () => void) {
  listeners.add(listener);
  const standaloneQuery = window.matchMedia("(display-mode: standalone)");
  standaloneQuery.addEventListener("change", listener);
  return () => {
    listeners.delete(listener);
    standaloneQuery.removeEventListener("change", listener);
  };
}

export function currentInstallMode(): InstallMode {
  const standalone = installed
    || window.matchMedia("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return installMode({
    standalone,
    hasPrompt: deferredPrompt !== null,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
  });
}

/** Show the browser's install dialog; the event can only be used once. */
export async function promptInstall() {
  const prompt = deferredPrompt;
  if (!prompt) return;
  deferredPrompt = null;
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  if (outcome === "accepted") installed = true;
  notify();
}
