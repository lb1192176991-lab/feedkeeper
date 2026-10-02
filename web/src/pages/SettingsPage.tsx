import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/AuthContext.tsx";
import { AccountSettings } from "../components/settings/AccountSettings.tsx";
import { GeneralSettings } from "../components/settings/GeneralSettings.tsx";
import { FilterSettings } from "../components/settings/FilterSettings.tsx";
import { McpSettings } from "../components/settings/McpSettings.tsx";
import { DevicesSettings } from "../components/settings/DevicesSettings.tsx";
import { DatabaseSettings, UsersSettings } from "../components/settings/AdminSettings.tsx";
import { SectionHeader } from "../components/settings/ui.tsx";

const icon = (path: ReactNode) => (
  <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>
);

interface Section {
  id: string;
  label: string;
  description: string;
  icon: ReactNode;
  admin?: boolean;
  render: () => ReactNode;
}

export function SettingsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const sections: Section[] = [
    { id: "account", label: t("settings.sectionAccount"), description: t("settings.sectionAccountHint"), icon: icon(<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>), render: () => <AccountSettings /> },
    { id: "general", label: t("settings.sectionGeneral"), description: t("settings.sectionGeneralHint"), icon: icon(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>), render: () => <GeneralSettings /> },
    { id: "filters", label: t("settings.sectionFilters"), description: t("settings.sectionFiltersHint"), icon: icon(<path d="M3 5h18l-7 8v6l-4 2v-8Z" />), render: () => <FilterSettings /> },
    { id: "devices", label: t("settings.sectionDevices"), description: t("settings.sectionDevicesHint"), icon: icon(<><rect x="7" y="2" width="10" height="20" rx="2.5" /><path d="M11 18h2" /></>), render: () => <DevicesSettings /> },
    { id: "mcp", label: t("settings.sectionMcp"), description: t("settings.sectionMcpHint"), icon: icon(<><path d="M9 7V3M15 7V3M6 7h12v4a6 6 0 0 1-12 0Z" /><path d="M12 17v4" /></>), render: () => <McpSettings /> },
    { id: "users", label: t("settings.sectionUsers"), description: t("settings.sectionUsersHint"), icon: icon(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" /></>), admin: true, render: () => <UsersSettings /> },
    { id: "database", label: t("settings.sectionDatabase"), description: t("settings.sectionDatabaseHint"), icon: icon(<><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>), admin: true, render: () => <DatabaseSettings /> },
  ];
  const available = sections.filter((section) => !section.admin || user?.role === "admin");
  const active = available.find((section) => section.id === searchParams.get("tab")) ?? available[0];

  const select = (id: string) => {
    setSearchParams(id === available[0].id ? {} : { tab: id }, { replace: true });
    window.scrollTo({ top: 0 });
  };

  const navButton = (section: Section, variant: "side" | "chip") => {
    const isActive = section.id === active.id;
    const base = "inline-flex items-center gap-2.5 font-medium transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--c-blue3)]";
    const style = variant === "side"
      ? `w-full rounded-lg px-3 py-2 text-left text-sm ${isActive ? "bg-[var(--c-mobile-nav-active)] text-[var(--c-text)]" : "text-[var(--c-text-muted)] hover:bg-[var(--c-surface-hover)] hover:text-[var(--c-text)]"}`
      : `shrink-0 rounded-full border px-3 py-1.5 text-sm ${isActive ? "border-[var(--c-mobile-nav-active-border)] bg-[var(--c-mobile-nav-active)] text-[var(--c-text)]" : "border-[var(--c-border)] text-[var(--c-text-muted)]"}`;
    return (
      <button key={section.id} type="button" onClick={() => select(section.id)} aria-current={isActive ? "page" : undefined} className={`${base} ${style}`}>
        {section.icon}
        {section.label}
      </button>
    );
  };

  const adminSections = available.filter((section) => section.admin);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>

      <div className="md:grid md:grid-cols-[13rem_minmax(0,1fr)] md:gap-10">
        <nav className="-mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-1 md:hidden" aria-label={t("settings.title")}>
          {available.map((section) => navButton(section, "chip"))}
        </nav>

        <nav className="sticky top-24 hidden flex-col gap-0.5 self-start md:flex" aria-label={t("settings.title")}>
          {available.filter((section) => !section.admin).map((section) => navButton(section, "side"))}
          {adminSections.length > 0 && (
            <>
              <p className="mt-5 mb-1 px-3 text-xs font-semibold tracking-[0.08em] uppercase text-[var(--c-text-muted)]">{t("settings.adminGroup")}</p>
              {adminSections.map((section) => navButton(section, "side"))}
            </>
          )}
        </nav>

        <div key={active.id} className="min-w-0 animate-page-fade">
          <SectionHeader title={active.label} description={active.description} />
          {active.render()}
        </div>
      </div>
    </div>
  );
}
