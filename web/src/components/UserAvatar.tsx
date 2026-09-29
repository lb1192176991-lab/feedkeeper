import { useState } from "react";
import { avatarUrl, type User } from "../api/client.ts";

export function initials(name: string, email: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return email.charAt(0).toUpperCase() || "?";
  const first = words[0].charAt(0);
  const last = words.length > 1 ? words[words.length - 1].charAt(0) : "";
  return (first + last).toUpperCase();
}

/** Profile photo with an initials fallback when none is set or it fails to load. */
export function UserAvatar({ user, className = "" }: { user: Pick<User, "display_name" | "email" | "avatar_updated_at">; className?: string }) {
  const url = avatarUrl(user);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  return (
    <span className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--c-border)] bg-[var(--c-mobile-nav-active)] font-semibold tracking-wide text-[var(--c-text)] ${className}`}>
      {url && failedUrl !== url ? (
        <img src={url} alt="" className="h-full w-full object-cover" onError={() => setFailedUrl(url)} />
      ) : (
        <span aria-hidden="true">{initials(user.display_name, user.email)}</span>
      )}
    </span>
  );
}
