import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, type Token } from "../../api/client.ts";
import { CustomSelect } from "../CustomSelect.tsx";
import { formatRelativeTime } from "../../utils/relativeTime.ts";
import { SettingsCard, SettingBlock } from "./ui.tsx";

function CopyButton({ value }: { value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="btn-secondary shrink-0 px-3 py-1.5 text-sm"
    >
      {copied ? t("settings.copied") : t("settings.copyToken")}
    </button>
  );
}

function ScopeBadge({ scope }: { scope: Token["scope"] }) {
  const { t } = useTranslation();
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${scope === "write" ? "bg-[var(--c-danger-bg)] text-[var(--c-danger)]" : "bg-[var(--c-mobile-nav-active)] text-[var(--c-text-muted)]"}`}>
      {scope === "read" ? t("settings.tokenReadOnly") : t("settings.tokenReadWrite")}
    </span>
  );
}

export function McpSettings() {
  const { t, i18n } = useTranslation();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<Token["scope"]>("read");
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const mcpUrl = `${window.location.origin}/mcp`;
  const dateFormatter = new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: "medium" });

  async function load() {
    setTokens(await api.listTokens());
  }

  useEffect(() => {
    void load();
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const { token } = await api.createToken(name, scope);
    setFreshToken(token);
    setName("");
    await load();
  }

  async function onDelete(token: Token) {
    if (!confirm(t("settings.revokeTokenConfirm", { name: token.name }))) return;
    await api.deleteToken(token.id);
    await load();
  }

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard title={t("settings.mcpTitle")} description={t("settings.mcpHint")}>
        <SettingBlock>
          <div className="flex items-center gap-2 rounded-xl border border-[var(--c-border)] bg-[var(--c-bg)] py-1.5 pl-3 pr-1.5">
            <code className="min-w-0 flex-1 truncate text-sm">{mcpUrl}</code>
            <CopyButton value={mcpUrl} />
          </div>
          <ol className="mt-4 flex list-decimal flex-col gap-1 pl-5 text-sm text-[var(--c-text-muted)]">
            <li>{t("settings.mcpStepToken")}</li>
            <li>{t("settings.mcpStepUrl")}</li>
            <li>{t("settings.mcpStepHeader")}</li>
          </ol>
          <div className="mt-5 border-t border-[var(--c-border)] pt-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--c-text-muted)]">
                {t("settings.mcpClaudeTitle")}
              </span>
              <button
                type="button"
                onClick={async () => {
                  const snippet = JSON.stringify({
                    mcpServers: {
                      feedkeeper: {
                        url: mcpUrl,
                        headers: {
                          Authorization: `Bearer ${freshToken ?? "<YOUR_TOKEN>"}`
                        }
                      }
                    }
                  }, null, 2);
                  await navigator.clipboard.writeText(snippet);
                  alert(t("settings.mcpConfigCopied"));
                }}
                className="btn-secondary shrink-0 px-2.5 py-1 text-xs"
              >
                {t("settings.mcpCopyConfig")}
              </button>
            </div>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-[var(--c-bg)] p-3 text-xs text-[var(--c-text-muted)]">
{`{
  "mcpServers": {
    "feedkeeper": {
      "url": "${mcpUrl}",
      "headers": {
        "Authorization": "Bearer ${freshToken ? freshToken : "<YOUR_TOKEN>"}"
      }
    }
  }
}`}
            </pre>
          </div>
        </SettingBlock>
      </SettingsCard>

      <SettingsCard title={t("settings.tokensTitle")} description={t("settings.tokensHint")}>
        {freshToken && (
          <SettingBlock>
            <div className="rounded-xl border border-[var(--c-green3)] p-3">
              <p className="text-sm font-medium">{t("settings.tokenCreated")}</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all text-xs">{freshToken}</code>
                <CopyButton value={freshToken} />
              </div>
              <p className="mt-2 text-xs text-[var(--c-text-muted)]">{t("settings.tokenCreatedHint")}</p>
            </div>
          </SettingBlock>
        )}

        <SettingBlock>
          <form onSubmit={onCreate} className="flex flex-col gap-3 sm:flex-row">
            <input type="text" required placeholder={t("settings.tokenNamePlaceholder")} aria-label={t("settings.tokenNamePlaceholder")} className="input sm:flex-1" value={name} onChange={(e) => setName(e.target.value)} />
            <CustomSelect
              value={scope}
              onChange={(value) => setScope(value as Token["scope"])}
              options={[
                { value: "read", label: t("settings.tokenReadOnly") },
                { value: "write", label: t("settings.tokenReadWrite") },
              ]}
              className="sm:w-48"
            />
            <button type="submit" className="btn-primary whitespace-nowrap">{t("settings.createToken")}</button>
          </form>
        </SettingBlock>

        {tokens.length === 0 ? (
          <SettingBlock><p className="text-sm text-[var(--c-text-muted)]">{t("settings.noTokens")}</p></SettingBlock>
        ) : (
          tokens.map((token) => (
            <div key={token.id} className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{token.name}</span>
                  <ScopeBadge scope={token.scope} />
                </div>
                <p className="mt-0.5 truncate text-xs text-[var(--c-text-muted)]">
                  <code>{token.token_prefix}…</code>
                  {" · "}
                  {t("settings.tokenCreatedOn", { date: dateFormatter.format(new Date(token.created_at)) })}
                  {" · "}
                  {token.last_used_at ? t("settings.tokenLastUsed", { time: formatRelativeTime(new Date(token.last_used_at), i18n.resolvedLanguage) }) : t("settings.tokenNeverUsed")}
                </p>
              </div>
              <button type="button" onClick={() => onDelete(token)} className="btn-secondary shrink-0 px-3 py-1.5 text-sm hover:text-[var(--c-danger)]">
                {t("settings.deleteToken")}
              </button>
            </div>
          ))
        )}
      </SettingsCard>
    </div>
  );
}
