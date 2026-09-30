import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export interface ActionMenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** Compact "⋯" button that opens a list of actions; flips upward near the bottom of the screen. */
export function ActionMenu({ label, items, className = "" }: { label: string; items: ActionMenuItem[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const [upward, setUpward] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setUpward(window.innerHeight - rect.bottom < 48 * items.length + 24);
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={menuId}
        className={`flex h-9 w-9 items-center justify-center rounded-lg text-[var(--c-text-muted)] transition-colors hover:bg-[var(--c-surface-hover)] hover:text-[var(--c-text)] focus-visible:outline-2 focus-visible:outline-[var(--c-blue3)] cursor-pointer ${open ? "bg-[var(--c-surface-hover)] text-[var(--c-text)]" : ""}`}
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>

      {open && (
        <div
          id={menuId}
          className={`card animate-fade-in absolute right-0 z-40 w-64 p-1.5 ${upward ? "bottom-full mb-2" : "top-full mt-2"}`}
          style={{ boxShadow: "0 16px 40px -12px rgba(0, 0, 0, 0.35)" }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={item.disabled}
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
                item.onSelect();
              }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-default ${
                item.danger
                  ? "text-[var(--c-danger)] hover:bg-[var(--c-danger-bg)]"
                  : "text-[var(--c-text)] hover:bg-[var(--c-surface-hover)]"
              }`}
            >
              {item.icon && <span className={`flex h-4 w-4 shrink-0 items-center justify-center ${item.danger ? "" : "text-[var(--c-text-muted)]"}`}>{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
