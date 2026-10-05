import { findItemById, canAccessItem } from "../feeds/repository.js";
import { sourceText, contentMetadata } from "../feeds/articleContent.js";

/** Complete cached source material; consumers must explicitly chunk their own bounded requests. */
export function cachedEditionSources(userId: number, itemIds: number[]) {
  if (itemIds.length > 24 || new Set(itemIds).size !== itemIds.length) throw new Error("invalid_source_selection");
  return itemIds.map(id => {
    const item = findItemById(id);
    if (!item || !canAccessItem(userId, id)) throw new Error("item_not_found");
    return { id, text: sourceText(item), textKind: contentMetadata(item).source,
      revision: item.content_revision, status: item.extraction_status, truncated: false };
  });
}
