/**
 * Safely parses and sanitizes untrusted HTML from RSS feeds using native DOMParser.
 * Does not execute scripts during parsing.
 * Strips script tags, iframes, styles, objects, forms, and inline event handlers (on*).
 * Removes tracking pixels, layout-breaking float/align attributes, and duplicate hero images.
 * Ensures external links open in a new tab with rel="noopener noreferrer".
 */
export interface SanitizeOptions {
  heroImageUrl?: string | null;
}

export function sanitizeHtml(rawHtml: string, options?: SanitizeOptions): string {
  if (!rawHtml) return "";

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHtml, "text/html");

    const forbiddenTags = [
      "script",
      "style",
      "iframe",
      "frame",
      "frameset",
      "object",
      "embed",
      "applet",
      "form",
      "input",
      "button",
      "textarea",
      "select",
      "meta",
      "link",
      "base",
    ];

    for (const tag of forbiddenTags) {
      const elements = doc.querySelectorAll(tag);
      elements.forEach((el) => el.remove());
    }

    // Helper to extract image filename/slug for duplicate detection
    function getImageFilename(urlStr?: string | null): string {
      if (!urlStr) return "";
      try {
        const u = new URL(urlStr, "https://dummy.local");
        const parts = u.pathname.split("/").filter(Boolean);
        return parts[parts.length - 1]?.toLowerCase() ?? "";
      } catch {
        return "";
      }
    }

    const heroFilename = getImageFilename(options?.heroImageUrl);
    const bodyTextLength = (doc.body.textContent || "").trim().length;

    // Process all images
    const images = Array.from(doc.querySelectorAll("img"));
    images.forEach((img, index) => {
      const src = img.getAttribute("src") ?? "";
      const imgFilename = getImageFilename(src);

      // Check if tracking pixel
      const width = img.getAttribute("width");
      const height = img.getAttribute("height");
      const isPixel =
        (width === "1" && height === "1") ||
        src.includes("feedsportal.com") ||
        src.includes("feedburner.com") ||
        src.includes("pixel.wp.com") ||
        src.includes("statcounter.com");

      // Check if duplicate of hero image
      const isDuplicateHero = Boolean(
        options?.heroImageUrl &&
          (src === options.heroImageUrl ||
            (heroFilename && imgFilename && heroFilename === imgFilename) ||
            // If hero image is present and this is the very first image in a short teaser, it's the teaser image
            (index === 0 && bodyTextLength < 400))
      );

      if (isPixel || isDuplicateHero) {
        const parent = img.parentElement;
        img.remove();
        // Remove empty parent anchors or paragraphs
        if (parent && parent.tagName.toLowerCase() === "a" && !parent.textContent?.trim()) {
          const grandParent = parent.parentElement;
          parent.remove();
          if (
            grandParent &&
            (grandParent.tagName.toLowerCase() === "p" || grandParent.tagName.toLowerCase() === "figure") &&
            !grandParent.textContent?.trim()
          ) {
            grandParent.remove();
          }
        } else if (
          parent &&
          (parent.tagName.toLowerCase() === "p" || parent.tagName.toLowerCase() === "figure") &&
          !parent.textContent?.trim()
        ) {
          parent.remove();
        }
        return;
      }

      // Strip layout-breaking attributes on remaining images
      img.removeAttribute("align");
      img.removeAttribute("hspace");
      img.removeAttribute("vspace");
      img.removeAttribute("border");
      img.removeAttribute("style");
      img.setAttribute("loading", "lazy");
    });

    // Clean attributes and links across all elements
    const allElements = doc.querySelectorAll("*");
    allElements.forEach((el) => {
      const attrs = Array.from(el.attributes);
      for (const attr of attrs) {
        const name = attr.name.toLowerCase();
        if (name.startsWith("on")) {
          el.removeAttribute(attr.name);
          continue;
        }

        if (name === "href" || name === "src") {
          const val = attr.value.trim().toLowerCase();
          if (
            val.startsWith("javascript:") ||
            val.startsWith("data:text/html") ||
            val.startsWith("vbscript:")
          ) {
            el.removeAttribute(attr.name);
          }
        }

        // Remove inline float/margin styles that cause text-wrap weirdness
        if (name === "style") {
          const style = attr.value.toLowerCase();
          if (style.includes("float") || style.includes("align") || style.includes("margin-right") || style.includes("margin-left")) {
            el.removeAttribute("style");
          }
        }
      }

      if (el.tagName.toLowerCase() === "a") {
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }
    });

    // Remove empty containers
    doc.querySelectorAll("p, div, figure, a").forEach((el) => {
      if (!el.textContent?.trim() && !el.querySelector("img, video, audio, iframe")) {
        el.remove();
      }
    });

    // Wrap bare text nodes in <p> if body has unwrapped text
    const childNodes = Array.from(doc.body.childNodes);
    const hasBareText = childNodes.some(
      (node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim())
    );
    if (hasBareText && !doc.body.querySelector("p")) {
      const p = doc.createElement("p");
      childNodes.forEach((node) => {
        p.appendChild(node);
      });
      doc.body.appendChild(p);
    }

    return doc.body.innerHTML;
  } catch (err) {
    console.error("Failed to sanitize HTML:", err);
    return "";
  }
}

/**
 * Calculates estimated reading time in minutes (default 200 words/min).
 */
export function estimateReadingTime(text: string): number {
  if (!text) return 1;
  const wordCount = text.trim().split(/\s+/).length;
  return Math.max(1, Math.ceil(wordCount / 200));
}
