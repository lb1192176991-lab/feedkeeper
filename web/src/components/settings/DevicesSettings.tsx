import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";
import { api, type Device, type PairingCode } from "../../api/client.ts";
import { formatRelativeTime } from "../../utils/relativeTime.ts";
import { toast } from "../../utils/toast.ts";
import { SettingBlock, SettingsCard } from "./ui.tsx";

function PairingPanel({ pairing, onDone }: { pairing: PairingCode; onDone: () => void }) {
  const { t } = useTranslation();
  const [qr, setQr] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(() => Math.max(0, Math.round((new Date(pairing.expiresAt).getTime() - Date.now()) / 1000)));

  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(pairing.pairingUrl, { margin: 1, width: 224, errorCorrectionLevel: "M" }).then((url) => {
      if (!cancelled) setQr(url);
    });
    return () => { cancelled = true; };
  }, [pairing.pairingUrl]);

  useEffect(() => {
    const timer = window.setInterval(() => setSecondsLeft(Math.max(0, Math.round((new Date(pairing.expiresAt).getTime() - Date.now()) / 1000))), 1000);
    return () => window.clearInterval(timer);
  }, [pairing.expiresAt]);

  const expired = secondsLeft === 0;
  return (
    <SettingBlock>
      <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:items-start sm:gap-6 sm:text-left">
        {qr && <img src={qr} alt={t("settings.deviceQrAlt")} width={224} height={224} className={`rounded-xl bg-white p-1 ${expired ? "opacity-30" : ""}`} />}
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-sm text-[var(--c-text-muted)]">{t("settings.devicePairHint")}</p>
          <code className="select-all rounded-lg border border-[var(--c-border)] bg-[var(--c-bg)] px-3 py-2 text-lg tracking-widest">{pairing.code}</code>
          <p className="text-xs text-[var(--c-text-muted)]" role="status">
            {expired ? t("settings.devicePairExpired") : t("settings.devicePairExpires", { minutes: Math.floor(secondsLeft / 60), seconds: String(secondsLeft % 60).padStart(2, "0") })}
          </p>
          <button type="button" onClick={onDone} className="btn-secondary self-center px-3 py-1.5 text-sm sm:self-start">{t("settings.devicePairDone")}</button>
        </div>
      </div>
    </SettingBlock>
  );
}

export function DevicesSettings() {
  const { t, i18n } = useTranslation();
  const [devices, setDevices] = useState<Device[]>([]);
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const next = await api.listDevices().catch(() => null);
    if (!next) return;
    // A new device means the code was used; there is nothing left to scan.
    setDevices((previous) => {
      if (next.length > previous.length && previous.length >= 0) setPairing(null);
      return next;
    });
  }

  useEffect(() => {
    void load();
    // A freshly paired device shows up without reloading the page.
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, []);

  async function onAdd() {
    setBusy(true);
    try {
      setPairing(await api.createPairingCode());
    } catch {
      toast.error(t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(device: Device) {
    if (!confirm(t("settings.deviceRevokeConfirm", { name: device.name }))) return;
    await api.revokeDevice(device.id);
    await load();
  }

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard
        title={t("settings.devicesTitle")}
        description={t("settings.devicesHint")}
        footer={<button type="button" disabled={busy} onClick={() => void onAdd()} className="btn-primary">{t("settings.deviceAdd")}</button>}
      >
        {pairing && <PairingPanel pairing={pairing} onDone={() => { setPairing(null); void load(); }} />}
        {devices.length === 0 ? (
          <SettingBlock><p className="text-sm text-[var(--c-text-muted)]">{t("settings.noDevices")}</p></SettingBlock>
        ) : (
          devices.map((device) => (
            <div key={device.id} className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{device.name}</p>
                <p className="mt-0.5 truncate text-xs text-[var(--c-text-muted)]">
                  {[device.platform, device.appVersion && `v${device.appVersion}`].filter(Boolean).join(" · ")}
                  {" · "}
                  {device.lastUsedAt ? t("settings.tokenLastUsed", { time: formatRelativeTime(new Date(device.lastUsedAt), i18n.resolvedLanguage) }) : t("settings.tokenNeverUsed")}
                </p>
              </div>
              <button type="button" onClick={() => void onRevoke(device)} className="btn-secondary shrink-0 px-3 py-1.5 text-sm hover:text-[var(--c-danger)]">{t("settings.deviceRevoke")}</button>
            </div>
          ))
        )}
      </SettingsCard>
    </div>
  );
}
