import { useTranslation } from "react-i18next";
import { CustomSelect } from "./CustomSelect.tsx";

const LANGUAGES = [
  { value: "de", label: "Deutsch" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
];

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();

  return (
    <CustomSelect
      value={i18n.resolvedLanguage ?? "de"}
      onChange={(lang) => i18n.changeLanguage(lang)}
      options={LANGUAGES}
      className="w-44"
      ariaLabel={t("settings.language")}
    />
  );
}
