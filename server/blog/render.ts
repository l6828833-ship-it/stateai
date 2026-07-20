/**
 * Server-side HTML rendering for the public blog.
 *
 * These pages are returned as fully-formed HTML (NOT the React SPA) so that
 * Googlebot and the AdSense crawler can read the article content, meta tags,
 * and structured data on the very first request — which SPA client rendering
 * cannot guarantee.
 */
import type { BlogCategory, BlogSettings } from "../../drizzle/schema";
import type { BlogPostWithCategory } from "../db";
import { parseTags, readingTimeMinutes } from "@shared/blog";

// ------------------------------- escaping ---------------------------------

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape a value for safe use inside an HTML attribute. */
function attr(value: string): string {
  return escapeHtml(value);
}

/** Escape a string for embedding inside a JSON-LD <script> block. */
function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

// ------------------------------- urls -------------------------------------

/** Resolve the public origin (https://host) from settings or the request. */
export function resolveOrigin(
  siteUrl: string | null,
  reqProto: string,
  reqHost: string
): string {
  if (siteUrl) {
    try {
      return new URL(siteUrl).origin;
    } catch {
      // fall through to request-derived origin
    }
  }
  const proto = reqProto || "https";
  return `${proto}://${reqHost}`;
}

/** Turn a possibly-relative media/link path into an absolute URL. */
export function absoluteUrl(origin: string, path: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${origin}${path.startsWith("/") ? "" : "/"}${path}`;
}

function formatDate(value: Date | null): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function isoDate(value: Date | null): string {
  return value ? new Date(value).toISOString() : "";
}

// --------------------------- adsense / custom -----------------------------

/** Build the raw <head> injections: AdSense loader + admin header code. */
function renderHeadInjections(settings: BlogSettings): string {
  const parts: string[] = [];
  const header = settings.adsenseHeaderCode?.trim() ?? "";

  // Auto-inject the AdSense loader when a publisher id is configured and the
  // admin hasn't already pasted the loader script themselves.
  if (
    settings.adsenseClientId &&
    !/adsbygoogle\.js/i.test(header) &&
    !/adsbygoogle\.js/i.test(settings.customHeadHtml ?? "")
  ) {
    parts.push(
      `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${attr(
        settings.adsenseClientId
      )}" crossorigin="anonymous"></script>`
    );
    parts.push(
      `<meta name="google-adsense-account" content="${attr(settings.adsenseClientId)}">`
    );
  }
  if (header) parts.push(header);
  if (settings.customHeadHtml?.trim()) parts.push(settings.customHeadHtml);
  return parts.join("\n    ");
}

function renderFooterInjections(settings: BlogSettings): string {
  return settings.adsenseFooterCode?.trim() ?? "";
}

// ------------------------------- base css ---------------------------------

const BASE_CSS = `
:root{--bg:#FFF6F9;--card:#ffffff;--blush:#F7B8D0;--rose:#E894B5;--charcoal:#3A2E33;--muted:#8a7a80;--border:#f0dae2;--ring:#f4c9db}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--charcoal);font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.7;font-size:17px}
a{color:var(--rose);text-decoration:none}
a:hover{text-decoration:underline}
img{max-width:100%;height:auto;border-radius:12px}
h1,h2,h3,h4{font-family:Sora,Inter,system-ui,sans-serif;color:var(--charcoal);line-height:1.25;font-weight:700}
.container{max-width:820px;margin:0 auto;padding:0 20px}
.wide{max-width:1100px}
.site-header{position:sticky;top:0;z-index:20;background:rgba(255,246,249,.9);backdrop-filter:blur(10px);border-bottom:1px solid var(--border)}
.site-header .container{display:flex;align-items:center;justify-content:space-between;height:64px}
.brand{display:flex;align-items:center;gap:10px;font-family:Sora,sans-serif;font-weight:700;font-size:20px;color:var(--charcoal)}
.brand-badge{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,var(--rose),var(--blush));display:inline-block}
.nav a{color:var(--charcoal);font-weight:600;margin-left:18px;font-size:15px}
.hero{padding:48px 0 24px}
.hero h1{font-size:40px;margin:0 0 12px}
.hero p{color:var(--muted);font-size:19px;margin:0}
.crumbs{font-size:13px;color:var(--muted);padding:20px 0 0}
.crumbs a{color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:24px;padding:28px 0 8px}
.card{background:var(--card);border:1px solid var(--border);border-radius:18px;overflow:hidden;transition:transform .2s,box-shadow .2s;display:flex;flex-direction:column}
.card:hover{transform:translateY(-3px);box-shadow:0 24px 60px -40px rgba(58,46,51,.5)}
.card a{color:inherit;text-decoration:none}
.card-cover{aspect-ratio:16/9;width:100%;object-fit:cover;border-radius:0;display:block;background:var(--blush)}
.card-body{padding:18px 20px 22px}
.chip{display:inline-block;background:#fde7f0;color:var(--rose);font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;text-transform:uppercase;letter-spacing:.04em}
.card h2{font-size:20px;margin:12px 0 8px}
.card p{color:var(--muted);font-size:15px;margin:0}
.meta{color:var(--muted);font-size:14px;margin-top:14px}
.article{background:var(--card);border:1px solid var(--border);border-radius:22px;padding:34px;margin:22px 0 40px}
.article-cover{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:16px;margin-bottom:26px}
.article h1{font-size:38px;margin:0 0 14px}
.article-meta{display:flex;flex-wrap:wrap;gap:14px;color:var(--muted);font-size:15px;margin-bottom:26px;padding-bottom:22px;border-bottom:1px solid var(--border)}
.prose{font-size:18px}
.prose p{margin:0 0 20px}
.prose h2{font-size:28px;margin:36px 0 14px}
.prose h3{font-size:22px;margin:28px 0 12px}
.prose ul,.prose ol{margin:0 0 20px;padding-left:26px}
.prose li{margin:6px 0}
.prose img{margin:20px 0;border-radius:14px}
.prose blockquote{border-left:4px solid var(--rose);margin:24px 0;padding:6px 20px;background:#fde7f0;border-radius:0 12px 12px 0;color:var(--charcoal)}
.prose a{text-decoration:underline}
.prose pre{background:var(--charcoal);color:#fff;padding:18px;border-radius:12px;overflow:auto}
.prose code{background:#fde7f0;padding:2px 6px;border-radius:6px;font-size:15px}
.prose pre code{background:transparent;padding:0}
.tags{margin:26px 0 0;display:flex;flex-wrap:wrap;gap:8px}
.tags .chip{background:#f3eef0;color:var(--muted)}
.pagination{display:flex;justify-content:center;gap:12px;padding:24px 0 48px}
.pagination a,.pagination span{padding:10px 18px;border-radius:999px;border:1px solid var(--border);background:var(--card);font-weight:600;font-size:15px}
.pagination span{color:var(--muted)}
.cta{background:linear-gradient(135deg,var(--rose),var(--blush));color:#fff;border-radius:22px;padding:30px;margin:10px 0 44px;text-align:center}
.cta h3{color:#fff;margin:0 0 8px;font-size:24px}
.cta p{margin:0 0 18px;opacity:.95}
.cta a{display:inline-block;background:#fff;color:var(--rose);font-weight:700;padding:12px 26px;border-radius:999px}
.cta a:hover{text-decoration:none;opacity:.92}
.site-footer{border-top:1px solid var(--border);padding:36px 0;color:var(--muted);font-size:14px;text-align:center;margin-top:20px}
.site-footer a{color:var(--muted);margin:0 10px}
.empty{text-align:center;color:var(--muted);padding:60px 0}
.ad-slot{margin:26px 0}
@media(max-width:640px){.hero h1{font-size:31px}.article{padding:22px}.article h1{font-size:29px}.prose{font-size:17px}}
`;

// ------------------------------- layout -----------------------------------

interface LayoutOptions {
  settings: BlogSettings;
  origin: string;
  /** Full <title> text. */
  title: string;
  description: string;
  canonical: string;
  robots?: string;
  ogType?: "website" | "article";
  ogImage?: string | null;
  /** Extra raw markup injected at the end of <head> (JSON-LD, article meta). */
  extraHead?: string;
  bodyContent: string;
}

function renderLayout(opts: LayoutOptions): string {
  const {
    settings,
    origin,
    title,
    description,
    canonical,
    robots = "index, follow, max-image-preview:large",
    ogType = "website",
    ogImage,
    extraHead = "",
    bodyContent,
  } = opts;

  const siteName = settings.siteName || "Blog";
  const customCss = settings.customCss?.trim()
    ? `\n    <style id="blog-custom-css">${settings.customCss}</style>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${attr(description)}" />
    <meta name="robots" content="${attr(robots)}" />
    <link rel="canonical" href="${attr(canonical)}" />
    <meta property="og:site_name" content="${attr(siteName)}" />
    <meta property="og:type" content="${ogType}" />
    <meta property="og:title" content="${attr(title)}" />
    <meta property="og:description" content="${attr(description)}" />
    <meta property="og:url" content="${attr(canonical)}" />
    ${ogImage ? `<meta property="og:image" content="${attr(ogImage)}" />` : ""}
    <meta name="twitter:card" content="${ogImage ? "summary_large_image" : "summary"}" />
    <meta name="twitter:title" content="${attr(title)}" />
    <meta name="twitter:description" content="${attr(description)}" />
    ${ogImage ? `<meta name="twitter:image" content="${attr(ogImage)}" />` : ""}
    <link rel="alternate" type="application/rss+xml" title="${attr(siteName)} RSS" href="${attr(origin)}/rss.xml" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Sora:wght@600;700;800&display=swap" rel="stylesheet" />
    <style>${BASE_CSS}</style>${customCss}
    ${renderHeadInjections(settings)}
    ${extraHead}
  </head>
  <body>
    <header class="site-header">
      <div class="container wide">
        <a class="brand" href="/blog"><span class="brand-badge"></span>${escapeHtml(siteName)}</a>
        <nav class="nav">
          <a href="/blog">Blog</a>
          <a href="/">Home</a>
          <a href="/dashboard">Create a tour</a>
        </nav>
      </div>
    </header>
    <main>
${bodyContent}
    </main>
    <footer class="site-footer">
      <div class="container wide">
        <div>
          <a href="/blog">Blog</a>
          <a href="/">Home</a>
          <a href="/dashboard">Dashboard</a>
        </div>
        <p>&copy; ${new Date().getFullYear()} ${escapeHtml(siteName)}. All rights reserved.</p>
      </div>
    </footer>
    ${renderFooterInjections(settings)}
  </body>
</html>`;
}

// ------------------------------- pieces -----------------------------------

function postCard(origin: string, post: BlogPostWithCategory): string {
  const url = `/${post.categorySlug}/${post.slug}`;
  const cover = absoluteUrl(origin, post.coverImageUrl);
  const excerpt = post.excerpt ?? "";
  return `<article class="card">
        <a href="${attr(url)}">
          ${
            cover
              ? `<img class="card-cover" src="${attr(cover)}" alt="${attr(post.coverImageAlt ?? post.title)}" loading="lazy" />`
              : `<span class="card-cover"></span>`
          }
          <div class="card-body">
            <span class="chip">${escapeHtml(post.categoryName)}</span>
            <h2>${escapeHtml(post.title)}</h2>
            <p>${escapeHtml(excerpt)}</p>
            <div class="meta">${escapeHtml(formatDate(post.publishedAt))}</div>
          </div>
        </a>
      </article>`;
}

function pagination(basePath: string, page: number, pageCount: number): string {
  if (pageCount <= 1) return "";
  const prev =
    page > 1
      ? `<a href="${attr(pageHref(basePath, page - 1))}" rel="prev">← Previous</a>`
      : `<span>← Previous</span>`;
  const next =
    page < pageCount
      ? `<a href="${attr(pageHref(basePath, page + 1))}" rel="next">Next →</a>`
      : `<span>Next →</span>`;
  return `<div class="pagination">${prev}<span>Page ${page} of ${pageCount}</span>${next}</div>`;
}

function pageHref(basePath: string, page: number): string {
  if (page <= 1) return basePath;
  const sep = basePath.includes("?") ? "&" : "?";
  return `${basePath}${sep}page=${page}`;
}

function ctaBlock(): string {
  return `<div class="container"><div class="cta">
        <h3>Turn your listing photos into a cinematic tour</h3>
        <p>Upload photos and let AI direct a stunning property video in minutes.</p>
        <a href="/dashboard">Create your tour free</a>
      </div></div>`;
}

// ------------------------------- pages ------------------------------------

export function renderIndexPage(params: {
  settings: BlogSettings;
  origin: string;
  posts: BlogPostWithCategory[];
  categories: BlogCategory[];
  page: number;
  pageCount: number;
}): string {
  const { settings, origin, posts, categories, page, pageCount } = params;
  const blogTitle = settings.blogTitle || `${settings.siteName}`;
  const description =
    settings.siteDescription ||
    "Guides, tips, and inspiration for creating cinematic real-estate tour videos.";
  const canonical = `${origin}${pageHref("/blog", page)}`;

  const categoryNav = categories.length
    ? `<div class="container wide"><div style="padding:6px 0 0">${categories
        .map(
          c =>
            `<a class="chip" style="margin:4px 6px 4px 0" href="/${attr(c.slug)}">${escapeHtml(c.name)}</a>`
        )
        .join("")}</div></div>`
    : "";

  const list = posts.length
    ? `<div class="container wide"><div class="grid">${posts
        .map(p => postCard(origin, p))
        .join("\n")}</div></div>`
    : `<div class="container"><p class="empty">No articles published yet. Check back soon!</p></div>`;

  const jsonLdBlock = `<script type="application/ld+json">${jsonLd({
    "@context": "https://schema.org",
    "@type": "Blog",
    name: blogTitle,
    description,
    url: `${origin}/blog`,
  })}</script>`;

  const body = `<section class="hero"><div class="container wide">
        <h1>${escapeHtml(blogTitle)}</h1>
        <p>${escapeHtml(description)}</p>
      </div></section>
      ${categoryNav}
      ${list}
      <div class="container wide">${pagination("/blog", page, pageCount)}</div>
      ${ctaBlock()}`;

  return renderLayout({
    settings,
    origin,
    title: `${blogTitle}${page > 1 ? ` — Page ${page}` : ""}`,
    description,
    canonical,
    ogType: "website",
    extraHead: jsonLdBlock,
    bodyContent: body,
  });
}

export function renderCategoryPage(params: {
  settings: BlogSettings;
  origin: string;
  category: BlogCategory;
  posts: BlogPostWithCategory[];
  page: number;
  pageCount: number;
}): string {
  const { settings, origin, category, posts, page, pageCount } = params;
  const title =
    category.seoTitle || `${category.name} — ${settings.siteName}`;
  const description =
    category.seoDescription ||
    category.description ||
    `Articles about ${category.name}.`;
  const basePath = `/${category.slug}`;
  const canonical = `${origin}${pageHref(basePath, page)}`;

  const breadcrumb = `<script type="application/ld+json">${jsonLd({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Blog", item: `${origin}/blog` },
      {
        "@type": "ListItem",
        position: 2,
        name: category.name,
        item: canonical,
      },
    ],
  })}</script>`;

  const list = posts.length
    ? `<div class="container wide"><div class="grid">${posts
        .map(p => postCard(origin, p))
        .join("\n")}</div></div>`
    : `<div class="container"><p class="empty">No articles in this category yet.</p></div>`;

  const body = `<div class="container wide"><div class="crumbs"><a href="/blog">Blog</a> / ${escapeHtml(category.name)}</div></div>
      <section class="hero"><div class="container wide">
        <h1>${escapeHtml(category.name)}</h1>
        ${category.description ? `<p>${escapeHtml(category.description)}</p>` : ""}
      </div></section>
      ${list}
      <div class="container wide">${pagination(basePath, page, pageCount)}</div>
      ${ctaBlock()}`;

  return renderLayout({
    settings,
    origin,
    title,
    description,
    canonical,
    ogType: "website",
    extraHead: breadcrumb,
    bodyContent: body,
  });
}

export function renderPostPage(params: {
  settings: BlogSettings;
  origin: string;
  post: BlogPostWithCategory;
}): string {
  const { settings, origin, post } = params;
  const url = `${origin}/${post.categorySlug}/${post.slug}`;
  const title = post.seoTitle || `${post.title} — ${settings.siteName}`;
  const description =
    post.seoDescription || post.excerpt || post.title;
  const canonical = post.canonicalUrl || url;
  const ogImage =
    absoluteUrl(origin, post.ogImageUrl) ||
    absoluteUrl(origin, post.coverImageUrl);
  const author =
    post.authorName || settings.defaultAuthorName || settings.siteName;
  const tags = parseTags(post.tags);
  const cover = absoluteUrl(origin, post.coverImageUrl);
  const readMins = readingTimeMinutes(post.content);

  const articleMeta = [
    post.metaKeywords
      ? `<meta name="keywords" content="${attr(post.metaKeywords)}" />`
      : tags.length
        ? `<meta name="keywords" content="${attr(tags.join(", "))}" />`
        : "",
    author ? `<meta name="author" content="${attr(author)}" />` : "",
    `<meta property="article:published_time" content="${attr(isoDate(post.publishedAt))}" />`,
    `<meta property="article:modified_time" content="${attr(isoDate(post.updatedAt))}" />`,
    `<meta property="article:section" content="${attr(post.categoryName)}" />`,
    ...tags.map(t => `<meta property="article:tag" content="${attr(t)}" />`),
  ]
    .filter(Boolean)
    .join("\n    ");

  const articleJsonLd = jsonLd({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description,
    image: ogImage ? [ogImage] : undefined,
    datePublished: isoDate(post.publishedAt),
    dateModified: isoDate(post.updatedAt),
    author: { "@type": "Person", name: author },
    publisher: {
      "@type": "Organization",
      name: settings.siteName,
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
    articleSection: post.categoryName,
    keywords: tags.join(", ") || undefined,
    url,
  });

  const breadcrumbJsonLd = jsonLd({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Blog", item: `${origin}/blog` },
      {
        "@type": "ListItem",
        position: 2,
        name: post.categoryName,
        item: `${origin}/${post.categorySlug}`,
      },
      { "@type": "ListItem", position: 3, name: post.title, item: url },
    ],
  });

  const extraHead = `${articleMeta}
    <script type="application/ld+json">${articleJsonLd}</script>
    <script type="application/ld+json">${breadcrumbJsonLd}</script>`;

  const tagsBlock = tags.length
    ? `<div class="tags">${tags
        .map(t => `<span class="chip">${escapeHtml(t)}</span>`)
        .join("")}</div>`
    : "";

  const body = `<div class="container"><div class="crumbs"><a href="/blog">Blog</a> / <a href="/${attr(post.categorySlug)}">${escapeHtml(post.categoryName)}</a> / ${escapeHtml(post.title)}</div></div>
      <div class="container">
        <article class="article">
          <span class="chip">${escapeHtml(post.categoryName)}</span>
          <h1 style="margin-top:12px">${escapeHtml(post.title)}</h1>
          <div class="article-meta">
            <span>By ${escapeHtml(author)}</span>
            <span>${escapeHtml(formatDate(post.publishedAt))}</span>
            <span>${readMins} min read</span>
          </div>
          ${cover ? `<img class="article-cover" src="${attr(cover)}" alt="${attr(post.coverImageAlt ?? post.title)}" />` : ""}
          <div class="prose">${post.content}</div>
          ${tagsBlock}
          ${settings.postFooterHtml?.trim() ? settings.postFooterHtml : ""}
        </article>
      </div>
      ${ctaBlock()}`;

  return renderLayout({
    settings,
    origin,
    title,
    description,
    canonical,
    ogType: "article",
    ogImage,
    extraHead,
    bodyContent: body,
  });
}

export function renderNotFound(settings: BlogSettings, origin: string): string {
  const body = `<div class="container"><div class="empty">
        <h1>Article not found</h1>
        <p>The page you were looking for doesn't exist or has moved.</p>
        <p><a href="/blog">← Back to the blog</a></p>
      </div></div>`;
  return renderLayout({
    settings,
    origin,
    title: `Not found — ${settings.siteName}`,
    description: "The page you were looking for could not be found.",
    canonical: `${origin}/blog`,
    robots: "noindex, follow",
    bodyContent: body,
  });
}

// --------------------------- sitemap / robots / rss ------------------------

export function renderRobotsTxt(origin: string): string {
  return `User-agent: *
Allow: /

Sitemap: ${origin}/sitemap.xml
`;
}

export function renderAdsTxt(settings: BlogSettings): string | null {
  if (!settings.adsenseClientId) return null;
  const pub = settings.adsenseClientId.replace(/^ca-/, "");
  return `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`;
}

export function renderSitemap(params: {
  origin: string;
  categories: BlogCategory[];
  posts: Array<{
    slug: string;
    categorySlug: string;
    updatedAt: Date;
    publishedAt: Date | null;
  }>;
}): string {
  const { origin, categories, posts } = params;
  const urls: string[] = [];
  const add = (loc: string, lastmod?: Date | null, priority = "0.7") => {
    urls.push(
      `  <url><loc>${escapeHtml(loc)}</loc>${
        lastmod ? `<lastmod>${new Date(lastmod).toISOString()}</lastmod>` : ""
      }<priority>${priority}</priority></url>`
    );
  };
  add(`${origin}/blog`, undefined, "0.8");
  for (const c of categories) add(`${origin}/${c.slug}`, undefined, "0.6");
  for (const p of posts) {
    add(`${origin}/${p.categorySlug}/${p.slug}`, p.updatedAt, "0.9");
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>`;
}

export function renderRss(params: {
  settings: BlogSettings;
  origin: string;
  posts: BlogPostWithCategory[];
}): string {
  const { settings, origin, posts } = params;
  const title = settings.blogTitle || settings.siteName;
  const description =
    settings.siteDescription || "Latest articles";
  const items = posts
    .slice(0, 30)
    .map(p => {
      const link = `${origin}/${p.categorySlug}/${p.slug}`;
      return `    <item>
      <title>${escapeHtml(p.title)}</title>
      <link>${escapeHtml(link)}</link>
      <guid isPermaLink="true">${escapeHtml(link)}</guid>
      <category>${escapeHtml(p.categoryName)}</category>
      ${p.publishedAt ? `<pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate>` : ""}
      <description>${escapeHtml(p.excerpt ?? "")}</description>
    </item>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeHtml(title)}</title>
    <link>${escapeHtml(`${origin}/blog`)}</link>
    <description>${escapeHtml(description)}</description>
    <language>en</language>
    <atom:link href="${escapeHtml(`${origin}/rss.xml`)}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;
}
