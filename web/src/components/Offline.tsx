import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/AuthContext.tsx";
import { pendingCount, subscribeQueue } from "../utils/offlineQueue.ts";

function subscribe(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}

/** Tells readers that what they see was loaded earlier and that changes will not go through. */
export function OfflineBanner() {
  const { t } = useTranslation();
  const pending = useSyncExternalStore(subscribeQueue, pendingCount, () => 0);
  if (useOnline()) return null;
  return (
    <div role="status" className="border-b px-4 py-2 text-center text-sm text-[var(--c-text-muted)]" style={{ borderColor: "var(--c-border)", backgroundColor: "var(--c-surface)" }}>
      {t("common.offlineBanner")}
      {pending > 0 && ` ${t("common.offlinePending", { count: pending })}`}
    </div>
  );
}

/** Shown when the app opens without a connection and without anything cached to show. */
export function OfflineScreen() {
  const { t } = useTranslation();
  const { refresh } = useAuth();
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[var(--c-bg)] px-6 text-center">
      <img src="/logo.svg" alt="" className="h-14 w-14" />
      <h1 className="text-xl font-semibold" style={{ fontFamily: "Manrope, sans-serif" }}>{t("common.offlineTitle")}</h1>
      <p className="max-w-sm text-sm text-[var(--c-text-muted)]">{t("common.offlineText")}</p>
      <button type="button" onClick={() => void refresh()} className="btn-primary">{t("common.retry")}</button>
    </div>
  );
}
