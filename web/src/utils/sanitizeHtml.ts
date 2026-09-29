import DOMPurify from "dompurify";

export interface SanitizeOptions {
  heroImageUrl?: string | null;
  baseUrl?: string | null;
}

export function safeHttpUrl(rawUrl: string, baseUrl?: string | null): string | null {
  try {
    const url = new URL(rawUrl, baseUrl || undefined);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function imageFilename(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).pathname.split("/").filter(Boolean).at(-1)?.toLowerCase() ?? "";
  } catch {
    return "";
  }
}

/** Sanitizes feed and extracted article HTML before it enters the page. */
export function sanitizeHtml(rawHtml: string, options: SanitizeOptions = {}): string {
  if (!rawHtml) return "";

  const sanitizeConfig = {
    USE_PROFILES: { html: true },
    ALLOWED_ATTR: ["href", "src", "alt", "title", "width", "height", "loading"],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ["form", "input", "button", "textarea", "select", "style", "video", "audio", "source"],
  };
  const cleanHtml = DOMPurify.sanitize(rawHtml, sanitizeConfig);
  const doc = new DOMParser().parseFromString(cleanHtml, "text/html");
  const heroUrl = options.heroImageUrl ? safeHttpUrl(options.heroImageUrl, options.baseUrl) : null;
  const heroFilename = imageFilename(heroUrl);
  const bodyTextLength = doc.body.textContent?.trim().length ?? 0;

  Array.from(doc.querySelectorAll("img")).forEach((img, index) => {
    const src = safeHttpUrl(img.getAttribute("src") ?? "", options.baseUrl);
    const filename = imageFilename(src);
    const isPixel =
      (img.getAttribute("width") === "1" && img.getAttribute("height") === "1") ||
      Boolean(src && /feedsportal\.com|feedburner\.com|pixel\.wp\.com|statcounter\.com/i.test(src));
    const isDuplicateHero = Boolean(
      heroUrl && src &&
      (src === heroUrl || (heroFilename && filename === heroFilename) || (index === 0 && bodyTextLength < 400)),
    );

    if (!src || isPixel || isDuplicateHero) {
      img.remove();
    } else {
      img.setAttribute("src", src);
      img.setAttribute("loading", "lazy");
    }
  });

  doc.querySelectorAll("a").forEach((link) => {
    const href = safeHttpUrl(link.getAttribute("href") ?? "", options.baseUrl);
    if (href) {
      link.setAttribute("href", href);
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    } else {
      link.removeAttribute("href");
    }
  });

  doc.querySelectorAll("p, div, figure, a").forEach((element) => {
    if (!element.textContent?.trim() && !element.querySelector("img")) element.remove();
  });

  const nodes = Array.from(doc.body.childNodes);
  if (nodes.some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) && !doc.body.querySelector("p")) {
    const paragraph = doc.createElement("p");
    nodes.forEach((node) => paragraph.appendChild(node));
    doc.body.appendChild(paragraph);
  }

  return DOMPurify.sanitize(doc.body.innerHTML, sanitizeConfig);
}

export function estimateReadingTime(text: string): number {
  if (!text) return 1;
  return Math.max(1, Math.ceil(text.trim().split(/\s+/).length / 200));
}
