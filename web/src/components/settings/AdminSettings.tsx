import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, type DatabaseStats, type User } from "../../api/client.ts";
import { CustomSelect } from "../CustomSelect.tsx";
import { UserAvatar } from "../UserAvatar.tsx";
import { SettingsCard, SettingBlock, SettingRow, Status, Toggle, type StatusMessage } from "./ui.tsx";

export function UsersSettings() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<User[]>([]);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<User["role"]>("user");
  const [message, setMessage] = useState<StatusMessage>(null);

  async function load() {
    setUsers(await api.listUsers());
  }

  useEffect(() => {
    void load();
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    try {
      await api.createUser({ email, password, displayName, role });
      setEmail("");
      setDisplayName("");
      setPassword("");
      setRole("user");
      setMessage({ type: "success", text: t("settings.userCreated") });
      await load();
    } catch {
      setMessage({ type: "error", text: t("common.error") });
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard title={t("settings.usersTitle")}>
        {users.map((u) => (
          <div key={u.id} className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
            <UserAvatar user={u} className="h-9 w-9 text-xs" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{u.display_name}</p>
              <p className="truncate text-xs text-[var(--c-text-muted)]">{u.email}</p>
            </div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${u.role === "admin" ? "bg-[var(--c-blue1)] text-white" : "bg-[var(--c-mobile-nav-active)] text-[var(--c-text-muted)]"}`}>
              {u.role === "admin" ? t("settings.roleAdmin") : t("settings.roleUser")}
            </span>
          </div>
        ))}
      </SettingsCard>

      <form onSubmit={onCreate}>
        <SettingsCard
          title={t("settings.addUser")}
          description={t("settings.addUserHint")}
          footer={
            <>
              <Status message={message} />
              <button type="submit" className="btn-primary">{t("settings.addUser")}</button>
            </>
          }
        >
          <SettingBlock>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input type="email" required placeholder={t("onboarding.emailLabel")} aria-label={t("onboarding.emailLabel")} className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
              <input type="text" required placeholder={t("onboarding.displayNameLabel")} aria-label={t("onboarding.displayNameLabel")} className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              <input type="password" required minLength={10} autoComplete="new-password" placeholder={t("onboarding.passwordLabel")} aria-label={t("onboarding.passwordLabel")} className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
              <CustomSelect
                value={role}
                onChange={(val) => setRole(val as User["role"])}
                options={[
                  { value: "user", label: t("settings.roleUser") },
                  { value: "admin", label: t("settings.roleAdmin") },
                ]}
                className="w-full"
              />
            </div>
          </SettingBlock>
        </SettingsCard>
      </form>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function NumberField({ id, value, max, onChange }: { id: string; value: number; max: number; onChange: (value: number) => void }) {
  return <input id={id} type="number" min={0} max={max} className="input w-28 text-right tabular-nums" value={value} onChange={(e) => onChange(Number(e.target.value))} />;
}

export function DatabaseSettings() {
  const { t, i18n } = useTranslation();
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [readDays, setReadDays] = useState(30);
  const [maxDays, setMaxDays] = useState(90);
  const [maxItems, setMaxItems] = useState(1000);
  const [autoCleanup, setAutoCleanup] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [message, setMessage] = useState<StatusMessage>(null);
  const number = new Intl.NumberFormat(i18n.resolvedLanguage);

  useEffect(() => {
    api.getRetention().then((data) => {
      setStats(data.stats);
      setReadDays(data.settings.retentionReadDays);
      setMaxDays(data.settings.retentionMaxDays);
      setMaxItems(data.settings.retentionMaxItemsPerFeed);
      setAutoCleanup(data.settings.autoCleanupEnabled);
    }).catch(() => {});
  }, []);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const data = await api.updateRetention({ retentionReadDays: readDays, retentionMaxDays: maxDays, retentionMaxItemsPerFeed: maxItems, autoCleanupEnabled: autoCleanup });
      setStats(data.stats);
      setMessage({ type: "success", text: t("settings.retentionSaved") });
    } catch {
      setMessage({ type: "error", text: t("common.error") });
    } finally {
      setSaving(false);
    }
  }

  async function onRunCleanup() {
    setCleaning(true);
    setMessage(null);
    try {
      const res = await api.runCleanup();
      setStats(res.stats);
      setMessage({
        type: "success",
        text: t("settings.cleanupSuccess", {
          total: res.result.totalDeleted,
          before: (res.result.sizeBefore / 1024 / 1024).toFixed(2),
          after: (res.result.sizeAfter / 1024 / 1024).toFixed(2),
        }),
      });
    } catch {
      setMessage({ type: "error", text: t("common.error") });
    } finally {
      setCleaning(false);
    }
  }

  const tiles = stats
    ? [
        { label: t("settings.statTotalItems"), value: number.format(stats.totalItems) },
        { label: t("settings.statReadItems"), value: number.format(stats.readItems) },
        { label: t("settings.statFeedsCount"), value: number.format(stats.feedsCount) },
        { label: t("settings.statDbSize"), value: formatBytes(stats.databaseSizeBytes) },
      ]
    : [];

  return (
    <div className="flex flex-col gap-5">
      {tiles.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map((tile) => (
            <div key={tile.label} className="card px-4 py-3">
              <p className="text-xs text-[var(--c-text-muted)]">{tile.label}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{tile.value}</p>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={onSave}>
        <SettingsCard
          title={t("settings.retentionTitle")}
          description={t("settings.retentionHint")}
          footer={
            <>
              <Status message={message} />
              <button type="button" disabled={cleaning} onClick={onRunCleanup} className="btn-secondary">{cleaning ? t("settings.cleaning") : t("settings.runCleanupNow")}</button>
              <button type="submit" disabled={saving} className="btn-primary">{t("settings.saveRetention")}</button>
            </>
          }
        >
          <SettingRow label={t("settings.autoCleanupLabel")} htmlFor="auto-cleanup" inline>
            <Toggle id="auto-cleanup" label={t("settings.autoCleanupLabel")} checked={autoCleanup} onChange={setAutoCleanup} />
          </SettingRow>
          <SettingRow label={t("settings.retentionReadDaysLabel")} hint={t("settings.retentionReadDaysHint")} htmlFor="retention-read">
            <NumberField id="retention-read" value={readDays} max={3650} onChange={setReadDays} />
          </SettingRow>
          <SettingRow label={t("settings.retentionMaxDaysLabel")} hint={t("settings.retentionMaxDaysHint")} htmlFor="retention-max">
            <NumberField id="retention-max" value={maxDays} max={3650} onChange={setMaxDays} />
          </SettingRow>
          <SettingRow label={t("settings.retentionMaxItemsLabel")} hint={t("settings.retentionMaxItemsHint")} htmlFor="retention-items">
            <NumberField id="retention-items" value={maxItems} max={100000} onChange={setMaxItems} />
          </SettingRow>
        </SettingsCard>
      </form>
    </div>
  );
}
