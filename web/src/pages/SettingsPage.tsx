import { useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  api,
  ApiError,
  type Token,
  type User,
  type RetentionSettings,
  type DatabaseStats,
  type CleanupResult,
  type MutedKeyword,
} from "../api/client.ts";
import { useAuth } from "../auth/AuthContext.tsx";
import { LanguageSwitcher } from "../components/LanguageSwitcher.tsx";
import { CustomSelect } from "../components/CustomSelect.tsx";
import { currentInstallMode, promptInstall, subscribeInstallPrompt } from "../utils/installPrompt.ts";
import { prepareAvatar } from "../utils/avatarImage.ts";
import { UserAvatar } from "../components/UserAvatar.tsx";

function ProfileSection() {
  const { t } = useTranslation();
  const { user, setCurrentUser } = useAuth();
  const [displayName, setDisplayName] = useState(user?.display_name ?? "");
  const [savingName, setSavingName] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!user) return null;
  const trimmedName = displayName.trim();

  async function onSaveName(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setSavingName(true);
    try {
      const updated = await api.updateProfile(trimmedName);
      setCurrentUser(updated);
      setDisplayName(updated.display_name);
      setMessage({ type: "success", text: t("settings.profileSaved") });
    } catch {
      setMessage({ type: "error", text: t("common.error") });
    } finally {
      setSavingName(false);
    }
  }

  async function onPhotoSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMessage(null);
    setUploading(true);
    try {
      setCurrentUser(await api.uploadAvatar(await prepareAvatar(file)));
    } catch (error) {
      setMessage({ type: "error", text: error instanceof ApiError ? t("common.error") : t("settings.avatarUnreadable") });
    } finally {
      setUploading(false);
    }
  }

  async function onRemovePhoto() {
    setMessage(null);
    setUploading(true);
    try {
      setCurrentUser(await api.deleteAvatar());
    } catch {
      setMessage({ type: "error", text: t("common.error") });
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="card p-5 flex flex-col gap-5">
      <h2 className="text-lg font-semibold">{t("settings.profileTitle")}</h2>

      <div className="flex items-center gap-4">
        <UserAvatar user={user} className={`h-20 w-20 text-2xl transition-opacity ${uploading ? "opacity-50" : ""}`} />
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary text-sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              {user.avatar_updated_at ? t("settings.avatarChange") : t("settings.avatarUpload")}
            </button>
            {user.avatar_updated_at && (
              <button type="button" className="btn-secondary text-sm text-danger" disabled={uploading} onClick={onRemovePhoto}>
                {t("settings.avatarRemove")}
              </button>
            )}
          </div>
          <p className="text-xs" style={{ color: "var(--c-text-muted)" }}>{t("settings.avatarHint")}</p>
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onPhotoSelected} />
      </div>

      <form onSubmit={onSaveName} className="flex flex-col gap-3 max-w-sm">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t("settings.displayNameLabel")}</span>
          <input
            className="input"
            required
            maxLength={100}
            autoComplete="name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>
        {message && (
          <p className={`text-sm ${message.type === "error" ? "text-danger" : ""}`} style={message.type === "success" ? { color: "var(--c-green3)" } : undefined}>
            {message.text}
          </p>
        )}
        <button type="submit" disabled={savingName || !trimmedName || trimmedName === user.display_name} className="btn-primary self-start">
          {t("common.save")}
        </button>
      </form>
    </section>
  );
}

function InstallAppRow() {
  const { t } = useTranslation();
  const mode = useSyncExternalStore(subscribeInstallPrompt, currentInstallMode);
  if (mode === "installed" || mode === "unsupported") return null;

  return (
    <div className="pt-4 border-t border-[var(--c-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
      <div>
        <h3 className="text-base font-semibold">{t("settings.installApp")}</h3>
        <p className="text-sm mt-0.5" style={{ color: "var(--c-text-muted)" }}>
          {mode === "ios" ? t("settings.installAppIos") : mode === "mac-safari" ? t("settings.installAppMacSafari") : t("settings.installAppHint")}
        </p>
      </div>
      {mode === "prompt" && (
        <button type="button" onClick={() => void promptInstall()} className="btn-primary whitespace-nowrap self-start sm:self-center">
          {t("settings.installAppButton")}
        </button>
      )}
    </div>
  );
}

function PreferencesSection() {
  const { t } = useTranslation();
  const [autoReaderMode, setAutoReaderMode] = useState(() => {
    return localStorage.getItem("feedkeeper_auto_reader_mode") !== "false";
  });

  const handleToggleAutoReader = (checked: boolean) => {
    setAutoReaderMode(checked);
    localStorage.setItem("feedkeeper_auto_reader_mode", checked ? "true" : "false");
  };

  return (
    <section className="card p-5 flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">{t("settings.language")}</h2>
        <p className="text-sm mt-0.5" style={{ color: "var(--c-text-muted)" }}>
          {t("settings.languageHint")}
        </p>
        <div className="mt-3">
          <LanguageSwitcher />
        </div>
      </div>

      <div className="pt-4 border-t border-[var(--c-border)] flex items-center justify-between gap-4">
        <div>
          <label htmlFor="auto-reader-toggle" className="text-base font-semibold cursor-pointer select-none">
            {t("settings.autoReaderMode")}
          </label>
          <p className="text-sm mt-0.5" style={{ color: "var(--c-text-muted)" }}>
            {t("settings.autoReaderModeHint")}
          </p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer shrink-0">
          <input
            id="auto-reader-toggle"
            type="checkbox"
            className="sr-only peer"
            checked={autoReaderMode}
            onChange={(e) => handleToggleAutoReader(e.target.checked)}
          />
          <div className="w-11 h-6 bg-[var(--c-border)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--c-blue1)]" />
        </label>
      </div>

      <InstallAppRow />
    </section>
  );
}

function ChangePasswordSection() {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);

    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: t("settings.passwordMismatch") });
      return;
    }

    setSubmitting(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setMessage({ type: "success", text: t("settings.passwordChanged") });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setMessage({ type: "error", text: t("settings.incorrectPassword") });
      } else {
        setMessage({ type: "error", text: t("common.error") });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="card p-5 flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t("settings.changePasswordTitle")}</h2>
      <form onSubmit={onSubmit} className="flex flex-col gap-3 max-w-sm">
        <input
          type="password"
          required
          placeholder={t("settings.currentPasswordLabel")}
          className="input"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
        <input
          type="password"
          required
          minLength={10}
          placeholder={t("settings.newPasswordLabel")}
          className="input"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <input
          type="password"
          required
          minLength={10}
          placeholder={t("settings.confirmPasswordLabel")}
          className="input"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
        {message && (
          <p className={`text-sm ${message.type === "error" ? "text-danger" : ""}`} style={message.type === "success" ? { color: "var(--c-green3)" } : undefined}>
            {message.text}
          </p>
        )}
        <button type="submit" disabled={submitting} className="btn-primary">
          {t("settings.changePasswordButton")}
        </button>
      </form>
    </section>
  );
}

function TokensSection() {
  const { t } = useTranslation();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "write">("read");
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    setTokens(await api.listTokens());
  }

  useEffect(() => {
    load();
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const { token } = await api.createToken(name, scope);
    setFreshToken(token);
    setName("");
    await load();
  }

  async function onDelete(id: number) {
    await api.deleteToken(id);
    await load();
  }

  async function copy() {
    if (!freshToken) return;
    await navigator.clipboard.writeText(freshToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const mcpUrl = `${window.location.origin}/mcp`;

  return (
    <section className="card p-5 flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{t("settings.tokensTitle")}</h2>
        <p className="text-sm" style={{ color: "var(--c-text-muted)" }}>
          {t("settings.tokensHint")}
        </p>
      </div>

      {freshToken && (
        <div
          className="card p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          style={{ borderColor: "var(--c-green3)" }}
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">{t("settings.tokenCreated")}</p>
            <code className="text-xs break-all">{freshToken}</code>
            <p className="text-xs mt-1" style={{ color: "var(--c-text-muted)" }}>
              {t("settings.tokenCreatedHint")}
            </p>
          </div>
          <button onClick={copy} className="btn-secondary text-sm whitespace-nowrap">
            {copied ? t("settings.copied") : t("settings.copyToken")}
          </button>
        </div>
      )}

      <form onSubmit={onCreate} className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          required
          placeholder={t("settings.tokenNamePlaceholder")}
          className="input sm:flex-1"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <CustomSelect
          value={scope}
          onChange={(value) => setScope(value as "read" | "write")}
          options={[
            { value: "read", label: t("settings.tokenReadOnly") },
            { value: "write", label: t("settings.tokenReadWrite") },
          ]}
          className="sm:w-44"
        />
        <button type="submit" className="btn-primary whitespace-nowrap">
          {t("settings.createToken")}
        </button>
      </form>

      <ul className="flex flex-col gap-2">
        {tokens.map((tok) => (
          <li key={tok.id} className="flex items-center justify-between text-sm py-2 border-t" style={{ borderColor: "var(--c-border)" }}>
            <span>
              {tok.name} <code style={{ color: "var(--c-text-muted)" }}>{tok.token_prefix}…</code>
              <span className="ml-2" style={{ color: "var(--c-text-muted)" }}>
                {tok.scope === "read" ? t("settings.tokenReadOnly") : t("settings.tokenReadWrite")}
              </span>
            </span>
            <button onClick={() => onDelete(tok.id)} className="btn-secondary text-xs">
              {t("settings.deleteToken")}
            </button>
          </li>
        ))}
      </ul>

      <div className="pt-2 border-t" style={{ borderColor: "var(--c-border)" }}>
        <h3 className="font-medium text-sm mb-1">{t("settings.mcpTitle")}</h3>
        <p className="text-sm mb-2" style={{ color: "var(--c-text-muted)" }}>
          {t("settings.mcpHint")}
        </p>
        <code className="text-xs break-all block card p-2">{mcpUrl}</code>
      </div>
    </section>
  );
}

function UsersSection() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<User[]>([]);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setUsers(await api.listUsers());
  }

  useEffect(() => {
    load();
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createUser({ email, password, displayName, role });
      setEmail("");
      setDisplayName("");
      setPassword("");
      setRole("user");
      await load();
    } catch {
      setError(t("common.error"));
    }
  }

  return (
    <section className="card p-5 flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t("settings.usersTitle")}</h2>

      <form onSubmit={onCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input
          type="email"
          required
          placeholder={t("onboarding.emailLabel")}
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="text"
          required
          placeholder={t("onboarding.displayNameLabel")}
          className="input"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <input
          type="password"
          required
          minLength={10}
          placeholder={t("onboarding.passwordLabel")}
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <CustomSelect
          value={role}
          onChange={(val) => setRole(val as "admin" | "user")}
          options={[
            { value: "user", label: t("settings.roleUser") },
            { value: "admin", label: t("settings.roleAdmin") },
          ]}
          className="w-full"
        />
        <button type="submit" className="btn-primary sm:col-span-2">
          {t("settings.addUser")}
        </button>
      </form>
      {error && <p className="text-sm text-danger">{error}</p>}

      <ul className="flex flex-col gap-2">
        {users.map((u) => (
          <li key={u.id} className="flex items-center justify-between text-sm py-2 border-t" style={{ borderColor: "var(--c-border)" }}>
            <span>
              {u.display_name} <span style={{ color: "var(--c-text-muted)" }}>({u.email})</span>
            </span>
            <span className="text-xs uppercase" style={{ color: "var(--c-text-muted)" }}>
              {u.role === "admin" ? t("settings.roleAdmin") : t("settings.roleUser")}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RetentionSection() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<RetentionSettings | null>(null);
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [readDays, setReadDays] = useState(30);
  const [maxDays, setMaxDays] = useState(90);
  const [maxItems, setMaxItems] = useState(1000);
  const [autoCleanup, setAutoCleanup] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function load() {
    try {
      const data = await api.getRetention();
      setSettings(data.settings);
      setStats(data.stats);
      setReadDays(data.settings.retentionReadDays);
      setMaxDays(data.settings.retentionMaxDays);
      setMaxItems(data.settings.retentionMaxItemsPerFeed);
      setAutoCleanup(data.settings.autoCleanupEnabled);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const data = await api.updateRetention({
        retentionReadDays: Number(readDays),
        retentionMaxDays: Number(maxDays),
        retentionMaxItemsPerFeed: Number(maxItems),
        autoCleanupEnabled: autoCleanup,
      });
      setSettings(data.settings);
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
      const beforeMb = (res.result.sizeBefore / 1024 / 1024).toFixed(2);
      const afterMb = (res.result.sizeAfter / 1024 / 1024).toFixed(2);
      setMessage({
        type: "success",
        text: t("settings.cleanupSuccess", {
          total: res.result.totalDeleted,
          before: beforeMb,
          after: afterMb,
        }),
      });
    } catch {
      setMessage({ type: "error", text: t("common.error") });
    } finally {
      setCleaning(false);
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  return (
    <section className="card p-5 flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold">{t("settings.retentionTitle")}</h2>
        <p className="text-sm mt-1" style={{ color: "var(--c-text-muted)" }}>
          {t("settings.retentionHint")}
        </p>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-xl border bg-[var(--c-bg)]" style={{ borderColor: "var(--c-border)" }}>
          <div>
            <span className="text-xs uppercase block" style={{ color: "var(--c-text-muted)" }}>{t("settings.statTotalItems")}</span>
            <span className="text-lg font-semibold">{stats.totalItems.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-xs uppercase block" style={{ color: "var(--c-text-muted)" }}>{t("settings.statReadItems")}</span>
            <span className="text-lg font-semibold">{stats.readItems.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-xs uppercase block" style={{ color: "var(--c-text-muted)" }}>{t("settings.statFeedsCount")}</span>
            <span className="text-lg font-semibold">{stats.feedsCount}</span>
          </div>
          <div>
            <span className="text-xs uppercase block" style={{ color: "var(--c-text-muted)" }}>{t("settings.statDbSize")}</span>
            <span className="text-lg font-semibold">{formatBytes(stats.databaseSizeBytes)}</span>
          </div>
        </div>
      )}

      {message && (
        <p className={`text-sm ${message.type === "success" ? "text-emerald-500" : "text-danger"}`}>
          {message.text}
        </p>
      )}

      <form onSubmit={onSave} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-sm font-medium block mb-1">{t("settings.retentionReadDaysLabel")}</label>
            <input
              type="number"
              min={0}
              max={3650}
              className="input w-full"
              value={readDays}
              onChange={(e) => setReadDays(Number(e.target.value))}
            />
            <span className="text-xs block mt-1" style={{ color: "var(--c-text-muted)" }}>
              {t("settings.retentionReadDaysHint")}
            </span>
          </div>

          <div>
            <label className="text-sm font-medium block mb-1">{t("settings.retentionMaxDaysLabel")}</label>
            <input
              type="number"
              min={0}
              max={3650}
              className="input w-full"
              value={maxDays}
              onChange={(e) => setMaxDays(Number(e.target.value))}
            />
            <span className="text-xs block mt-1" style={{ color: "var(--c-text-muted)" }}>
              {t("settings.retentionMaxDaysHint")}
            </span>
          </div>

          <div>
            <label className="text-sm font-medium block mb-1">{t("settings.retentionMaxItemsLabel")}</label>
            <input
              type="number"
              min={0}
              max={100000}
              className="input w-full"
              value={maxItems}
              onChange={(e) => setMaxItems(Number(e.target.value))}
            />
            <span className="text-xs block mt-1" style={{ color: "var(--c-text-muted)" }}>
              {t("settings.retentionMaxItemsHint")}
            </span>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer mt-1">
          <input
            type="checkbox"
            checked={autoCleanup}
            onChange={(e) => setAutoCleanup(e.target.checked)}
            className="rounded"
          />
          <span>{t("settings.autoCleanupLabel")}</span>
        </label>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button type="submit" disabled={saving} className="btn-primary">
            {t("settings.saveRetention")}
          </button>
          <button
            type="button"
            disabled={cleaning}
            onClick={onRunCleanup}
            className="btn-secondary"
          >
            {cleaning ? t("settings.cleaning") : t("settings.runCleanupNow")}
          </button>
        </div>
      </form>
    </section>
  );
}

function MutedKeywordsSection() {
  const { t } = useTranslation();
  const [keywords, setKeywords] = useState<MutedKeyword[]>([]);
  const [newKeyword, setNewKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const data = await api.listMutedKeywords();
      setKeywords(data.keywords);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    load();
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
    <section className="card p-5 flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{t("settings.mutedKeywordsTitle")}</h2>
        <p className="text-sm mt-1" style={{ color: "var(--c-text-muted)" }}>
          {t("settings.mutedKeywordsHint")}
        </p>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <form onSubmit={onAdd} className="flex gap-2 max-w-md">
        <input
          type="text"
          placeholder={t("settings.mutedKeywordPlaceholder")}
          className="input flex-1"
          value={newKeyword}
          onChange={(e) => setNewKeyword(e.target.value)}
        />
        <button type="submit" disabled={loading || !newKeyword.trim()} className="btn-primary whitespace-nowrap">
          {t("settings.addMutedKeyword")}
        </button>
      </form>

      {keywords.length > 0 ? (
        <div className="flex flex-wrap gap-2 pt-1">
          {keywords.map((k) => (
            <span
              key={k.id}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border"
              style={{
                borderColor: "var(--c-border)",
                backgroundColor: "var(--c-bg)",
                color: "var(--c-text)",
              }}
            >
              <span>{k.keyword}</span>
              <button
                type="button"
                onClick={() => onRemove(k.id)}
                title={t("settings.removeMutedKeyword")}
                className="hover:opacity-75 p-0.5 text-xs text-danger flex items-center justify-center cursor-pointer"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs italic" style={{ color: "var(--c-text-muted)" }}>
          {t("settings.noMutedKeywords")}
        </p>
      )}
    </section>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>
      <ProfileSection />
      <PreferencesSection />
      <ChangePasswordSection />
      <TokensSection />
      <MutedKeywordsSection />
      {user?.role === "admin" && <UsersSection />}
      {user?.role === "admin" && <RetentionSection />}
    </div>
  );
}
