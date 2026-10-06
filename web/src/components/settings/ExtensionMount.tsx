import { useEffect, useRef } from "react";
import type { SettingsExtensionSection } from "../../settings/host.ts";

/** Hands a container to a section of the hosting product and cleans up when the section closes. */
export function ExtensionMount({ section }: { section: SettingsExtensionSection }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let cleanup: void | (() => void);
    try {
      cleanup = section.mount(element);
    } catch (error) {
      console.error(`[settings] section "${section.id}" failed to open`, error);
    }
    return () => {
      try {
        if (typeof cleanup === "function") cleanup();
      } catch (error) {
        console.error(`[settings] section "${section.id}" failed to close`, error);
      }
      element.replaceChildren();
    };
  }, [section.id]);
  return <div ref={container} className="min-w-0" />;
}
