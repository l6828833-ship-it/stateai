/** Shared blog helpers used by the server router, SSR layer, and admin UI. */

/**
 * Top-level path segments the blog must never use as a category slug, because
 * they are real application/API routes or reserved SSR endpoints. A category
 * whose slug is reserved would shadow those routes in `/{category}/...`.
 */
export const RESERVED_BLOG_SLUGS = new Set<string>([
  "api",
  "admin",
  "dashboard",
  "login",
  "signup",
  "logout",
  "change-password",
  "auth",
  "billing",
  "manus-storage",
  "__manus__",
  "assets",
  "src",
  "node_modules",
  "blog",
  "sitemap.xml",
  "sitemap",
  "robots.txt",
  "robots",
  "ads.txt",
  "rss.xml",
  "rss",
  "feed",
  "feed.xml",
  "favicon.ico",
  "favicon",
  "404",
  "health",
  "public",
  "static",
]);

/** Convert arbitrary text into a URL-safe, lowercase slug. */
export function slugify(input: string): string {
  return input
    .toString()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-") // non-alphanumerics -> hyphen
    .replace(/^-+|-+$/g, "") // trim leading/trailing hyphens
    .replace(/-{2,}/g, "-") // collapse repeats
    .slice(0, 80);
}

export function isReservedBlogSlug(slug: string): boolean {
  return RESERVED_BLOG_SLUGS.has(slug.toLowerCase());
}

/** Validate a slug's shape (does not check reserved list or uniqueness). */
export function isValidBlogSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 80;
}

/** Rough reading time in minutes from HTML content (~200 wpm). */
export function readingTimeMinutes(html: string): number {
  const text = html.replace(/<[^>]+>/g, " ");
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/** Build a plain-text excerpt from HTML content. */
export function excerptFromHtml(html: string, maxLength = 160): string {
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

/** Parse a comma-separated tag string into a clean, de-duplicated list. */
export function parseTags(tags: string | null | undefined): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags.split(",")) {
    const tag = raw.trim();
    if (tag && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase());
      result.push(tag);
    }
  }
  return result;
}
