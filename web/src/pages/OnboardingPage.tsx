import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.ts";
import { useAuth } from "../auth/AuthContext.tsx";
import { BrandLockup } from "../components/BrandLockup.tsx";

export function OnboardingPage() {
  const { t } = useTranslation();
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.onboard({ email, password, displayName });
      await refresh();
    } catch {
      setError(t("common.error"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card p-8 w-full max-w-md">
        <div className="flex flex-col items-center mb-6 text-center">
          <h1 className="mb-3">
            <BrandLockup size={44} />
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--c-text-muted)" }}>
            {t("onboarding.subtitle")}
          </p>
        </div>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-sm font-medium block mb-1">{t("onboarding.emailLabel")}</label>
            <input
              type="email"
              required
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">{t("onboarding.displayNameLabel")}</label>
            <input
              type="text"
              required
              className="input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">{t("onboarding.passwordLabel")}</label>
            <input
              type="password"
              required
              minLength={10}
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="text-xs mt-1" style={{ color: "var(--c-text-muted)" }}>
              {t("onboarding.passwordHint")}
            </p>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <button type="submit" disabled={submitting} className="btn-primary">
            {t("onboarding.submit")}
          </button>
        </form>
        <div className="mt-6 pt-4 border-t text-sm" style={{ borderColor: "var(--c-border)" }}>
          <p className="font-medium">{t("onboarding.orUseCli")}</p>
          <p style={{ color: "var(--c-text-muted)" }}>{t("onboarding.cliHint")}</p>
        </div>
      </div>
    </div>
  );
}
