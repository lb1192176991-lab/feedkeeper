import { useTranslation } from "react-i18next";

export function LoadingSpinner({
  className = "",
  size = "md",
  center = true,
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
  center?: boolean;
}) {
  const { t } = useTranslation();
  const sizeMap = {
    sm: "w-5 h-5 border-2",
    md: "w-8 h-8 border-[2.5px]",
    lg: "w-10 h-10 border-3",
  };

  const spinner = (
    <div
      className={`rounded-full animate-spin border-[var(--c-border)] border-t-[var(--c-blue1)] dark:border-t-white/80 ${sizeMap[size]} ${className}`}
      role="status"
      aria-label={t("common.loading")}
    />
  );

  if (center) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-h-[45vh] w-full py-12 animate-fade-in">
        {spinner}
      </div>
    );
  }

  return spinner;
}
