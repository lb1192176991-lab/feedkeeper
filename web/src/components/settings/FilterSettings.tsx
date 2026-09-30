import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, type MutedKeyword } from "../../api/client.ts";
import { SettingsCard, SettingBlock } from "./ui.tsx";

export function FilterSettings() {
  const { t } = useTranslation();
  const [keywords, setKeywords] = useState<MutedKeyword[]>([]);
  const [newKeyword, setNewKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listMutedKeywords().then((data) => setKeywords(data.keywords)).catch(() => {});
  }, []);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!newKeyword.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const added = await api.addMutedKeyword(newKeyword.trim());
      setKeywords((prev) => (prev.some((k) => k.id === added.id) ? prev : [...prev, added]));
      setNewKeyword("");
    } catch {
      setError(t("common.error"));
    } finally {
      setLoading(false);
    }
  }

  async function onRemove(id: number) {
    try {
      await api.deleteMutedKeyword(id);
      setKeywords((prev) => prev.filter((k) => k.id !== id));
    } catch {
      setError(t("common.error"));
    }
  }

  return (
    <SettingsCard title={t("settings.mutedKeywordsTitle")} description={t("settings.mutedKeywordsHint")}>
      <SettingBlock>
        <form onSubmit={onAdd} className="flex gap-2">
          <input type="text" placeholder={t("settings.mutedKeywordPlaceholder")} aria-label={t("settings.mutedKeywordPlaceholder")} className="input flex-1" value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)} />
          <button type="submit" disabled={loading || !newKeyword.trim()} className="btn-primary whitespace-nowrap">{t("settings.addMutedKeyword")}</button>
        </form>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}

        {keywords.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {keywords.map((k) => (
              <span key={k.id} className="inline-flex items-center gap-1 rounded-full border border-[var(--c-border)] bg-[var(--c-bg)] py-1 pl-3 pr-1 text-sm">
                {k.keyword}
                <button type="button" onClick={() => onRemove(k.id)} title={t("settings.removeMutedKeyword")} aria-label={`${t("settings.removeMutedKeyword")}: ${k.keyword}`} className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--c-text-muted)] hover:bg-[var(--c-danger-bg)] hover:text-[var(--c-danger)] cursor-pointer">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-[var(--c-text-muted)]">{t("settings.noMutedKeywords")}</p>
        )}
      </SettingBlock>
    </SettingsCard>
  );
}
