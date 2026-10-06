# Extending the web app

A product built on FeedKeeper, such as FeedKeeper Cloud, can add pages to the settings and hide built-in ones without patching the web app. The page reads a plain object from `window`; a script of the host fills it. Nothing here is needed for a regular installation.

## Settings sections

```js
// Any script that runs on the page, before or after the app starts.
const settings = (window.feedkeeperSettings ??= { sections: [], hidden: [] });

settings.hidden.push("database"); // hide a built-in section by its id
settings.sections.push({
  id: "plan",                      // ?tab=plan, lowercase letters, digits and dashes
  label: "Plan",
  shortLabel: "Plan",              // optional, for the chip row on narrow screens
  description: "Your plan and invoices.",
  group: "Billing",                // heading in the navigation
  icon: ["M4 6h16M4 12h16M4 18h10"], // optional: path data of a 24×24 stroked icon
  admin: false,                    // true: only administrators see it
  mount(container) {
    container.textContent = "Hello";
    return () => { /* optional cleanup when the section closes */ };
  },
});

window.dispatchEvent(new Event("feedkeeper:settings-changed"));
```

- Built-in section ids: `account`, `general`, `filters`, `devices`, `mcp`, `users`, `database`.
- Sections of the host are listed after the built-in ones, under their group heading. Groups appear in the order of their first section.
- `mount` receives an empty element, once each time the section opens. The function it returns runs when the section closes or the page unmounts it. The section is opened through `?tab=<id>`, so links and reloads keep it.
- Everything is validated: an entry with a missing field, an invalid or repeated id, an id of a built-in section or a `mount` that is not a function is ignored. `admin` sections are left out for other users, and `hidden` only affects built-in ids. A `mount` that throws is logged and leaves an empty section.
- The app reads the object when the page renders and whenever `feedkeeper:settings-changed` is dispatched on `window`, so the order in which the host script and the app start does not matter.

The code lives in `web/src/settings/host.ts` (validation), `web/src/settings/useSettingsHost.ts` and `web/src/pages/SettingsPage.tsx`.
