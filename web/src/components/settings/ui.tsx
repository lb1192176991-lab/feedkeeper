import type { ReactNode } from "react";

/** A titled group of settings; rows inside are separated by hairlines. */
export function SettingsCard({ title, description, children, footer }: { title?: string; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="card">
      {(title || description) && (
        <header className="px-5 pt-5 pb-1 sm:px-6">
          {title && <h3 className="text-base font-semibold">{title}</h3>}
          {description && <p className="mt-1 text-sm text-[var(--c-text-muted)]">{description}</p>}
        </header>
      )}
      <div className="divide-y divide-[var(--c-border)]">{children}</div>
      {footer && <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-[var(--c-border)] px-5 py-4 sm:px-6">{footer}</footer>}
    </section>
  );
}

/** Label and hint on the left, the control on the right (stacked on phones). */
export function SettingRow({ label, hint, htmlFor, children, stacked = false, inline = false }: { label: ReactNode; hint?: ReactNode; htmlFor?: string; children?: ReactNode; stacked?: boolean; inline?: boolean }) {
  // `inline` keeps small controls such as toggles beside the label on phones too.
  const layout = stacked ? "flex-col" : inline ? "flex-row items-center justify-between gap-4 sm:gap-6" : "flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-6";
  return (
    <div className={`flex gap-3 px-5 py-4 sm:px-6 ${layout}`}>
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="text-sm font-medium">{label}</label>
        {hint && <p className="mt-0.5 text-sm text-[var(--c-text-muted)]">{hint}</p>}
      </div>
      {children && <div className={stacked ? "" : "shrink-0"}>{children}</div>}
    </div>
  );
}

/** Plain content block inside a card, with the card's padding. */
export function SettingBlock({ children }: { children: ReactNode }) {
  return <div className="px-5 py-4 sm:px-6">{children}</div>;
}

export function Toggle({ id, checked, onChange, label }: { id: string; checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <label className="relative inline-flex cursor-pointer items-center">
      <input id={id} type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span className="h-6 w-11 rounded-full bg-[var(--c-border)] transition-colors peer-checked:bg-[var(--c-blue1)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--c-blue3)] after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:content-[''] peer-checked:after:translate-x-5" />
    </label>
  );
}

export type StatusMessage = { type: "success" | "error"; text: string } | null;

export function Status({ message }: { message: StatusMessage }) {
  if (!message) return null;
  return (
    <p role="status" className={`text-sm ${message.type === "error" ? "text-danger" : "text-[var(--c-green3)]"}`}>
      {message.text}
    </p>
  );
}

/** Section heading shown above the cards of the active settings area. */
export function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-xl font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-[var(--c-text-muted)]">{description}</p>}
    </div>
  );
}
