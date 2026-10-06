import assert from "node:assert/strict";
import { test } from "node:test";
import { groupSettingsSections, resolveSettingsExtensions } from "../src/settings/host.ts";

const builtIn = ["account", "general", "users", "database"];
const section = (id, extra = {}) => ({ id, label: `Label ${id}`, description: "Beschreibung", group: "Kunden", mount: () => {}, ...extra });

test("a host adds sections and hides built-in ones, and everything it hands over is checked", () => {
  const host = {
    hidden: ["users", "database", "no-such-section", 42],
    sections: [
      section("tenants"),
      section("overview", { group: "Betrieb", shortLabel: "Start", icon: ["M4 6h16"] }),
      section("account"),                       // clashes with a built-in section
      section("tenants", { label: "Again" }),   // repeats an id: the first one counts
      section("Bad ID"),                        // not a valid id
      section("no-mount", { mount: undefined }),
      section("long-label", { label: "x".repeat(81) }),
      section("bad-icon", { icon: [1] }),
      section("bad-admin", { admin: "yes" }),
      null, "text", 7,
    ],
  };
  const result = resolveSettingsExtensions(host, builtIn, false);
  assert.deepEqual([...result.hidden].sort(), ["database", "users"]);
  assert.deepEqual(result.sections.map((entry) => entry.id), ["tenants", "overview"]);
  assert.equal(result.sections[0].label, "Label tenants");
});

test("sections for administrators stay hidden from everyone else", () => {
  const host = { sections: [section("plain"), section("secret", { admin: true })] };
  assert.deepEqual(resolveSettingsExtensions(host, builtIn, false).sections.map((entry) => entry.id), ["plain"]);
  assert.deepEqual(resolveSettingsExtensions(host, builtIn, true).sections.map((entry) => entry.id), ["plain", "secret"]);
  // An id that was refused to a regular user is not free for a later entry either.
  const clash = { sections: [section("secret", { admin: true }), section("secret", { label: "Other" })] };
  assert.deepEqual(resolveSettingsExtensions(clash, builtIn, false).sections, []);
});

test("nothing a script puts there can break the page", () => {
  for (const host of [undefined, null, "text", 5, [], { sections: "x", hidden: "y" }, { sections: [{}], hidden: [null] }]) {
    const result = resolveSettingsExtensions(host, builtIn, true);
    assert.equal(result.sections.length, 0);
    assert.equal(result.hidden.size, 0);
  }
});

test("sections are grouped in the order the groups first appear", () => {
  const groups = groupSettingsSections([
    { id: "a", group: "Kunden" }, { id: "b", group: "KI" }, { id: "c", group: "Kunden" }, { id: "d", group: "System" },
  ]);
  assert.deepEqual(groups.map((entry) => [entry.group, entry.sections.map((member) => member.id)]), [
    ["Kunden", ["a", "c"]], ["KI", ["b"]], ["System", ["d"]],
  ]);
});
