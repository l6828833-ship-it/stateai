/**
 * Tiny in-memory cache of published category slugs.
 *
 * Every top-level GET (e.g. `/dashboard`, `/login`) passes through the blog
 * catch-all before falling through to the SPA. To avoid a database hit on those
 * non-blog requests, we keep the small set of known category slugs in memory
 * and only query the database when the first path segment actually matches a
 * category. The cache is invalidated on category create/update/delete and also
 * self-refreshes on a short TTL.
 */
import * as db from "../db";

const TTL_MS = 60_000;

let slugs: Set<string> | null = null;
let loadedAt = 0;
let inflight: Promise<Set<string>> | null = null;

async function load(): Promise<Set<string>> {
  const categories = await db.listBlogCategories();
  slugs = new Set(categories.map(c => c.slug));
  loadedAt = Date.now();
  return slugs;
}

/** Returns the current set of category slugs, refreshing if stale. */
export async function getCategorySlugs(): Promise<Set<string>> {
  if (slugs && Date.now() - loadedAt < TTL_MS) return slugs;
  if (inflight) return inflight;
  inflight = load().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Fast check used by the SSR catch-all before touching the database. */
export async function isKnownCategorySlug(slug: string): Promise<boolean> {
  const set = await getCategorySlugs();
  return set.has(slug);
}

export function invalidateCategorySlugCache(): void {
  slugs = null;
  loadedAt = 0;
}
