const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** "vor 5 Minuten" / "5 minutes ago"; anything under a minute counts as now. */
export function formatRelativeTime(date: Date, locale: string | undefined, now = Date.now()): string {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const diff = date.getTime() - now;
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return format.format(Math.round(diff / ms), unit);
  }
  return format.format(0, "minute");
}
