import type { Item } from "../api/client.ts";

/** Keep the API order intact while placing occasional wide stories without grid gaps. */
export function editorialFeatures(items: Pick<Item, "image_url" | "content_snippet">[]): boolean[] {
  let column = 0;
  let lastFeature = -5;

  return items.map((item, index) => {
    const hasImage = /^https?:\/\//i.test(item.image_url ?? "");
    const hasStory = (item.content_snippet?.trim().length ?? 0) >= 220;
    const featured = (hasImage || hasStory) && index - lastFeature >= 5 && column <= 1;
    column = (column + (featured ? 2 : 1)) % 3;
    if (featured) lastFeature = index;
    return featured;
  });
}

/** Identify the regular card sharing a desktop row with a wide story. */
export function editorialCompanions(features: readonly boolean[]): boolean[] {
  const companions = features.map(() => false);
  let row: number[] = [];
  let columns = 0;

  features.forEach((featured, index) => {
    row.push(index);
    columns += featured ? 2 : 1;
    if (columns === 3) {
      if (row.some((itemIndex) => features[itemIndex])) {
        row.forEach((itemIndex) => { companions[itemIndex] = !features[itemIndex]; });
      }
      row = [];
      columns = 0;
    }
  });

  return companions;
}
