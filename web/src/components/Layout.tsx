import { useEffect } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/AuthContext.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";
import { resetItemsScrollY } from "../utils/scrollState.ts";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-2 rounded-lg text-sm font-medium ${
    isActive ? "bg-[var(--c-blue1)] text-white" : "text-[var(--c-text-muted)] hover:text-[var(--c-text)]"
  }`;

export function Layout() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const location = useLocation();

  // Scroll to top when switching to non-article pages
  useEffect(() => {
    if (location.pathname !== "/items") {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      });
    }
  }, [location.pathname]);

  const handleItemsClick = () => {
    if (location.pathname === "/items") {
      resetItemsScrollY();
      window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    }
  };

  const getActiveTabIndex = () => {
    if (location.pathname.startsWith("/feeds")) return 1;
    if (location.pathname.startsWith("/settings")) return 2;
    return 0; // /items or default
  };
  const activeTabIndex = getActiveTabIndex();

  const navLinksDesktop = (
    <>
      <NavLink to="/items" onClick={handleItemsClick} className={navLinkClass}>
        {t("nav.items")}
      </NavLink>
      <NavLink to="/feeds" className={navLinkClass}>
        {t("nav.feeds")}
      </NavLink>
    </>
  );

  return (
    <div className="min-h-screen flex flex-col">
      <header
        className="sticky top-0 z-30 backdrop-blur-md border-b"
        style={{
          borderColor: "var(--c-border)",
          backgroundColor: "color-mix(in srgb, var(--c-surface) 85%, transparent)",
          paddingTop: "env(safe-area-inset-top, 0px)",
        }}
      >
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6 min-w-0">
            <NavLink
              to="/items"
              onClick={handleItemsClick}
              className="flex items-center gap-2.5 shrink-0 hover:opacity-85 transition-opacity"
            >
              <img src="/logo.svg" alt="FeedKeeper" className="w-6 h-6 shrink-0" />
              <span className="font-semibold text-lg" style={{ fontFamily: "Manrope, sans-serif" }}>
                {t("common.appName")}
              </span>
            </NavLink>
            <nav className="hidden md:flex gap-1">{navLinksDesktop}</nav>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            {/* Desktop Settings Link */}
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                `hidden md:flex btn-secondary w-9 h-9 px-0 items-center justify-center shrink-0 cursor-pointer ${
                  isActive ? "text-[var(--c-text)] ring-1 ring-[var(--c-blue1)]" : "text-[var(--c-text-muted)] hover:text-[var(--c-text)]"
                }`
              }
              title={t("nav.settings")}
              aria-label={t("nav.settings")}
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </NavLink>

            {/* Logout Buttons */}
            {user && (
              <>
                <button
                  onClick={() => logout()}
                  className="hidden md:inline-flex btn-secondary text-sm"
                >
                  {t("nav.logout")}
                </button>
                <button
                  onClick={() => logout()}
                  className="md:hidden btn-secondary w-9 h-9 px-0 flex items-center justify-center shrink-0 cursor-pointer"
                  title={t("nav.logout")}
                  aria-label={t("nav.logout")}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main content with bottom padding for mobile tab bar */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 pt-4 pb-24 md:py-6">
        <div key={location.pathname} className="animate-page-fade">
          <Outlet />
        </div>
      </main>

      {/* Apple-style Floating Liquid Glass Tab Bar for Mobile */}
      <nav
        className="md:hidden fixed bottom-[max(0.75rem,env(safe-area-inset-bottom,0px))] left-3 right-3 max-w-sm mx-auto z-40 pointer-events-auto no-drag select-none"
        aria-label={t("nav.menu")}
      >
        <div
          className="relative flex items-center justify-between p-1.5 rounded-full border backdrop-blur-2xl backdrop-saturate-180 transition-all duration-300 shadow-xl no-drag select-none"
          style={{
            backgroundColor: "color-mix(in srgb, var(--c-surface) 80%, transparent)",
            borderColor: "var(--c-border)",
            borderWidth: "1px",
            boxShadow: "0 10px 30px -5px rgba(0, 0, 0, 0.35)",
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {/* Dynamic Sliding Pill Indicator */}
          <div
            aria-hidden="true"
            className="absolute top-1.5 bottom-1.5 left-1.5 rounded-full bg-white/20 dark:bg-white/12 border border-white/25 dark:border-white/15 shadow-xs transition-transform duration-300 ease-[cubic-bezier(0.25,1,0.5,1)] pointer-events-none no-drag"
            style={{
              width: "calc((100% - 0.75rem) / 3)",
              transform: `translateX(calc(${activeTabIndex} * 100%))`,
            }}
          />

          {/* Tab 1: Artikel */}
          <NavLink
            to="/items"
            onClick={handleItemsClick}
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            onContextMenu={(e) => e.preventDefault()}
            className="relative z-10 flex-1 min-w-0 no-drag select-none"
          >
            {({ isActive }) => (
              <div
                className={`h-[54px] w-full rounded-full flex flex-col items-center justify-center gap-0.5 transition-colors duration-200 cursor-pointer no-drag select-none ${
                  isActive
                    ? "text-[var(--c-text)] font-semibold"
                    : "text-[var(--c-text-muted)] hover:text-[var(--c-text)] font-medium"
                }`}
              >
                <svg
                  className={`w-5 h-5 transition-transform duration-200 pointer-events-none ${isActive ? "scale-105" : ""}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 6h16M4 12h16M4 18h12" />
                </svg>
                <span className="text-[11px] leading-tight tracking-tight pointer-events-none select-none">{t("nav.items")}</span>
              </div>
            )}
          </NavLink>

          {/* Tab 2: Feeds */}
          <NavLink
            to="/feeds"
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            onContextMenu={(e) => e.preventDefault()}
            className="relative z-10 flex-1 min-w-0 no-drag select-none"
          >
            {({ isActive }) => (
              <div
                className={`h-[54px] w-full rounded-full flex flex-col items-center justify-center gap-0.5 transition-colors duration-200 cursor-pointer no-drag select-none ${
                  isActive
                    ? "text-[var(--c-text)] font-semibold"
                    : "text-[var(--c-text-muted)] hover:text-[var(--c-text)] font-medium"
                }`}
              >
                <svg
                  className={`w-5 h-5 transition-transform duration-200 pointer-events-none ${isActive ? "scale-105" : ""}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 11a9 9 0 0 1 9 9" />
                  <path d="M4 4a16 16 0 0 1 16 16" />
                  <circle cx="5" cy="19" r="1" />
                </svg>
                <span className="text-[11px] leading-tight tracking-tight pointer-events-none select-none">{t("nav.feeds")}</span>
              </div>
            )}
          </NavLink>

          {/* Tab 3: Einstellungen */}
          <NavLink
            to="/settings"
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            onContextMenu={(e) => e.preventDefault()}
            className="relative z-10 flex-1 min-w-0 no-drag select-none"
          >
            {({ isActive }) => (
              <div
                className={`h-[54px] w-full rounded-full flex flex-col items-center justify-center gap-0.5 transition-colors duration-200 cursor-pointer no-drag select-none ${
                  isActive
                    ? "text-[var(--c-text)] font-semibold"
                    : "text-[var(--c-text-muted)] hover:text-[var(--c-text)] font-medium"
                }`}
              >
                <svg
                  className={`w-5 h-5 transition-transform duration-200 pointer-events-none ${isActive ? "scale-105" : ""}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                <span className="text-[11px] leading-tight tracking-tight pointer-events-none select-none">{t("nav.settings")}</span>
              </div>
            )}
          </NavLink>
        </div>
      </nav>
    </div>
  );
}
