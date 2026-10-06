// Extension point for the settings page: a hosting product (FeedKeeper Cloud) can add sections of its own
// and hide built-in ones without patching the app. Plain data and functions, so it works from any script.
//
//   window.feedkeeperSettings = window.feedkeeperSettings ?? { sections: [], hidden: [] };
//   window.feedkeeperSettings.sections.push({ id: "plan", label: "Plan", description: "…", group: "Billing",
//     mount(container) { container.textContent = "Hello"; return () => { /* cleanup */ }; } });
//   window.dispatchEvent(new Event("feedkeeper:settings-changed"));
//
// The script may run before or after the app starts; the app reads the object when the page renders and
// again whenever the event is dispatched. Everything in it is validated, a broken entry is ignored.

/** Dispatch on `window` after changing `window.feedkeeperSettings`. */
export const SETTINGS_CHANGED = "feedkeeper:settings-changed";

export interface SettingsExtensionSection {
  /** The `?tab=` value of the section. Lowercase letters, digits and dashes; must not clash with a built-in section. */
  id: string;
  label: string;
  /** Shorter label for the chip row on narrow screens. */
  shortLabel?: string;
  description: string;
  /** Heading in the navigation. Sections with the same group are listed together, in order of appearance. */
  group: string;
  /** Path data (`d` attributes) of a 24×24 stroked icon. */
  icon?: string[];
  /** Only administrators see the section. */
  admin?: boolean;
  /** Fills the container when the section opens. The returned function runs when it closes. */
  mount: (container: HTMLElement) => void | (() => void);
}

export interface ResolvedSettingsExtensions {
  /** Ids of built-in sections the host replaces. */
  hidden: Set<string>;
  sections: SettingsExtensionSection[];
}

declare global {
  interface Window {
    feedkeeperSettings?: unknown;
  }
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;

function validSection(value: unknown): value is SettingsExtensionSection {
  if (!value || typeof value !== "object") return false;
  const section = value as Record<string, unknown>;
  return (
    typeof section.id === "string" && ID_PATTERN.test(section.id) &&
    isText(section.label, 80) && isText(section.description, 300) && isText(section.group, 60) &&
    (section.shortLabel === undefined || isText(section.shortLabel, 40)) &&
    (section.icon === undefined || (Array.isArray(section.icon) && section.icon.length <= 8 && section.icon.every((path) => typeof path === "string" && path.length <= 400))) &&
    (section.admin === undefined || typeof section.admin === "boolean") &&
    typeof section.mount === "function"
  );
}

/**
 * What the host asks for, checked against the built-in sections. Entries that are malformed, repeat an id,
 * clash with a built-in id or are meant for administrators when the user is none are left out.
 */
export function resolveSettingsExtensions(host: unknown, builtInIds: string[], isAdmin: boolean): ResolvedSettingsExtensions {
  const data = host && typeof host === "object" ? (host as Record<string, unknown>) : {};
  const hidden = new Set(Array.isArray(data.hidden) ? data.hidden.filter((id): id is string => typeof id === "string" && builtInIds.includes(id)) : []);
  const taken = new Set(builtInIds);
  const sections: SettingsExtensionSection[] = [];
  for (const candidate of Array.isArray(data.sections) ? data.sections : []) {
    if (!validSection(candidate) || taken.has(candidate.id)) continue;
    taken.add(candidate.id);
    if (candidate.admin && !isAdmin) continue;
    sections.push(candidate);
  }
  return { hidden, sections };
}

/** Sections by group, groups in order of first appearance. */
export function groupSettingsSections<T extends { group?: string }>(sections: T[]): Array<{ group: string; sections: T[] }> {
  const groups: Array<{ group: string; sections: T[] }> = [];
  for (const section of sections) {
    const name = section.group ?? "";
    const existing = groups.find((entry) => entry.group === name);
    if (existing) existing.sections.push(section);
    else groups.push({ group: name, sections: [section] });
  }
  return groups;
}
