import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/** Current date that rolls over at midnight while the app stays open. */
function useToday() {
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    const midnight = new Date(today);
    midnight.setHours(24, 0, 1, 0);
    const timer = window.setTimeout(() => setToday(new Date()), midnight.getTime() - Date.now());
    return () => window.clearTimeout(timer);
  }, [today]);
  return today;
}

/** Newspaper-style dateline; the year is dropped on narrow screens to keep it on one line. */
export function TodayDate({ className = "" }: { className?: string }) {
  const { i18n } = useTranslation();
  const today = useToday();
  const format = (withYear: boolean) =>
    new Intl.DateTimeFormat(i18n.resolvedLanguage, { weekday: "long", day: "numeric", month: "long", ...(withYear ? { year: "numeric" } : {}) }).format(today);

  return (
    <time
      dateTime={today.toLocaleDateString("sv-SE")}
      className={`truncate text-xs font-semibold tracking-[0.08em] uppercase text-[var(--c-text-muted)] ${className}`}
    >
      <span className="sm:hidden">{format(false)}</span>
      <span className="hidden sm:inline">{format(true)}</span>
    </time>
  );
}
