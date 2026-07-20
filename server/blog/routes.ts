/**
 * Public blog HTTP routes (server-rendered HTML + SEO files).
 *
 * These are registered on the Express app BEFORE the SPA fallback so that:
 *   - `/blog`, `/{category}`, `/{category}/{slug}` return crawlable HTML
 *   - `/sitemap.xml`, `/robots.txt`, `/rss.xml`, `/ads.txt` are served
 * Any non-blog top-level path (e.g. `/dashboard`, `/login`, static assets)
 * falls through to the SPA via `next()`.
 */
import type { Express, NextFunction, Request, Response } from "express";
import { isReservedBlogSlug } from "@shared/blog";
import * as db from "../db";
import { isKnownCategorySlug } from "./cache";
import {
  renderAdsTxt,
  renderCategoryPage,
  renderIndexPage,
  renderNotFound,
  renderPostPage,
  renderRobotsTxt,
  renderRss,
  renderSitemap,
  resolveOrigin,
} from "./render";

const PAGE_SIZE = 9;
const HTML_CACHE = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";

function getOrigin(req: Request, siteUrl: string | null): string {
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] ||
    req.protocol ||
    "https";
  const host =
    (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0] ||
    req.get("host") ||
    "localhost";
  return resolveOrigin(siteUrl, proto, host);
}

function parsePage(value: unknown): number {
  const n = Number.parseInt(String(value ?? "1"), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function sendHtml(res: Response, html: string, status = 200): void {
  res
    .status(status)
    .set("Content-Type", "text/html; charset=utf-8")
    .set("Cache-Control", HTML_CACHE)
    .send(html);
}

export function registerBlogRoutes(app: Express): void {
  // ---- Blog index (paginated) ----
  app.get("/blog", async (req, res, next) => {
    try {
      const settings = await db.getBlogSettings();
      const origin = getOrigin(req, settings.siteUrl);
      const page = parsePage(req.query.page);
      const [{ items, pageCount }, categories] = await Promise.all([
        db.listBlogPosts({ page, pageSize: PAGE_SIZE, publishedOnly: true }),
        db.listBlogCategories(),
      ]);
      sendHtml(
        res,
        renderIndexPage({ settings, origin, posts: items, categories, page, pageCount })
      );
    } catch (error) {
      console.error("[Blog] index render failed", error);
      next();
    }
  });

  // ---- robots.txt ----
  app.get("/robots.txt", async (req, res, next) => {
    try {
      const settings = await db.getBlogSettings();
      const origin = getOrigin(req, settings.siteUrl);
      res
        .status(200)
        .set("Content-Type", "text/plain; charset=utf-8")
        .set("Cache-Control", "public, max-age=3600")
        .send(renderRobotsTxt(origin));
    } catch (error) {
      console.error("[Blog] robots.txt failed", error);
      next();
    }
  });

  // ---- ads.txt (AdSense verification) ----
  app.get("/ads.txt", async (_req, res, next) => {
    try {
      const settings = await db.getBlogSettings();
      const body = renderAdsTxt(settings);
      if (!body) {
        // No publisher id configured yet — let the SPA/static layer answer.
        next();
        return;
      }
      res
        .status(200)
        .set("Content-Type", "text/plain; charset=utf-8")
        .set("Cache-Control", "public, max-age=3600")
        .send(body);
    } catch (error) {
      console.error("[Blog] ads.txt failed", error);
      next();
    }
  });

  // ---- sitemap.xml ----
  app.get("/sitemap.xml", async (req, res, next) => {
    try {
      const settings = await db.getBlogSettings();
      const origin = getOrigin(req, settings.siteUrl);
      const [categories, posts] = await Promise.all([
        db.listBlogCategories(),
        db.listPublishedPostsForSitemap(),
      ]);
      res
        .status(200)
        .set("Content-Type", "application/xml; charset=utf-8")
        .set("Cache-Control", "public, max-age=600")
        .send(renderSitemap({ origin, categories, posts }));
    } catch (error) {
      console.error("[Blog] sitemap failed", error);
      next();
    }
  });

  // ---- rss.xml ----
  app.get("/rss.xml", async (req, res, next) => {
    try {
      const settings = await db.getBlogSettings();
      const origin = getOrigin(req, settings.siteUrl);
      const { items } = await db.listBlogPosts({
        page: 1,
        pageSize: 30,
        publishedOnly: true,
      });
      res
        .status(200)
        .set("Content-Type", "application/rss+xml; charset=utf-8")
        .set("Cache-Control", "public, max-age=600")
        .send(renderRss({ settings, origin, posts: items }));
    } catch (error) {
      console.error("[Blog] rss failed", error);
      next();
    }
  });

  // ---- Article: /{category}/{slug} ----
  // Registered before the single-segment category route. Both use RegExp paths
  // that exclude dots, so static assets (foo.js) never match.
  app.get(
    /^\/([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9][A-Za-z0-9-]*)\/?$/,
    async (req: Request, res: Response, next: NextFunction) => {
      const params = req.params as unknown as Record<string, string>;
      const categorySlug = params["0"];
      const postSlug = params["1"];
      try {
        if (isReservedBlogSlug(categorySlug)) return next();
        if (!(await isKnownCategorySlug(categorySlug))) return next();

        const settings = await db.getBlogSettings();
        const origin = getOrigin(req, settings.siteUrl);
        const post = await db.getBlogPostBySlug(postSlug, {
          publishedOnly: true,
        });

        // Unknown post under a real category → branded 404 (still on-brand SEO).
        if (!post) {
          sendHtml(res, renderNotFound(settings, origin), 404);
          return;
        }
        // The slug is globally unique; if its real category differs from the URL
        // segment, 301 to the canonical `/{realCategory}/{slug}` path.
        if (post.categorySlug !== categorySlug) {
          res.redirect(301, `/${post.categorySlug}/${post.slug}`);
          return;
        }

        // Fire-and-forget view counter (never blocks the response).
        void db.incrementBlogPostViews(post.id).catch(() => undefined);
        sendHtml(res, renderPostPage({ settings, origin, post }));
      } catch (error) {
        console.error("[Blog] post render failed", error);
        next();
      }
    }
  );

  // ---- Category: /{category} ----
  app.get(
    /^\/([A-Za-z0-9][A-Za-z0-9-]*)\/?$/,
    async (req: Request, res: Response, next: NextFunction) => {
      const params = req.params as unknown as Record<string, string>;
      const categorySlug = params["0"];
      try {
        if (isReservedBlogSlug(categorySlug)) return next();
        if (!(await isKnownCategorySlug(categorySlug))) return next();

        const category = await db.getBlogCategoryBySlug(categorySlug);
        if (!category) return next();

        const settings = await db.getBlogSettings();
        const origin = getOrigin(req, settings.siteUrl);
        const page = parsePage(req.query.page);
        const { items, pageCount } = await db.listBlogPosts({
          page,
          pageSize: PAGE_SIZE,
          categoryId: category.id,
          publishedOnly: true,
        });
        sendHtml(
          res,
          renderCategoryPage({
            settings,
            origin,
            category,
            posts: items,
            page,
            pageCount,
          })
        );
      } catch (error) {
        console.error("[Blog] category render failed", error);
        next();
      }
    }
  );
}
