import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  excerptFromHtml,
  isReservedBlogSlug,
  isValidBlogSlug,
  slugify,
} from "@shared/blog";
import * as db from "../db";
import { storagePut } from "../storage";
import { adminProcedure, publicProcedure, router } from "../_core/trpc";
import { invalidateCategorySlugCache } from "../blog/cache";

const MAX_CONTENT_LENGTH = 500_000; // ~500 KB of HTML per article
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB blog images
const MAX_IMAGE_BASE64_LENGTH = 4 * Math.ceil(MAX_IMAGE_BYTES / 3);

/** Detect a supported image type from magic bytes. Returns extension or null. */
function detectImageExtension(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpg";
  }
  // PNG
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "png";
  }
  // GIF
  if (buffer.toString("ascii", 0, 3) === "GIF") return "gif";
  // WEBP (RIFF....WEBP)
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

function contentTypeForExt(ext: string): string {
  switch (ext) {
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    default:
      return "image/jpeg";
  }
}

/** Validate + normalize a category slug (shape + reserved list). */
function normalizeCategorySlug(rawSlug: string, name: string): string {
  const slug = slugify(rawSlug.trim() || name);
  if (!slug || !isValidBlogSlug(slug)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Category slug must contain only lowercase letters, numbers, and hyphens",
    });
  }
  if (isReservedBlogSlug(slug)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `"${slug}" is a reserved word and cannot be used as a category URL`,
    });
  }
  return slug;
}

async function normalizePostSlug(
  rawSlug: string,
  title: string,
  excludeId?: number
): Promise<string> {
  const base = slugify(rawSlug.trim() || title);
  if (!base || !isValidBlogSlug(base)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Post slug must contain only lowercase letters, numbers, and hyphens",
    });
  }
  // Ensure global uniqueness by appending -2, -3, … when needed.
  let candidate = base;
  let suffix = 2;
  while (await db.blogSlugExists(candidate, excludeId)) {
    candidate = `${base}-${suffix++}`.slice(0, 90);
    if (suffix > 500) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Could not generate a unique slug for this post",
      });
    }
  }
  return candidate;
}

const categoryInput = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().max(160).optional(),
  description: z.string().trim().max(2000).optional(),
  seoTitle: z.string().trim().max(200).optional(),
  seoDescription: z.string().trim().max(320).optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
});

const postInput = z.object({
  title: z.string().trim().min(1).max(300),
  slug: z.string().trim().max(200).optional(),
  categoryId: z.number().int().positive(),
  excerpt: z.string().trim().max(500).optional(),
  content: z.string().max(MAX_CONTENT_LENGTH),
  coverImageUrl: z.string().trim().max(768).optional(),
  coverImageAlt: z.string().trim().max(300).optional(),
  authorName: z.string().trim().max(160).optional(),
  status: z.enum(["draft", "published"]).default("draft"),
  seoTitle: z.string().trim().max(200).optional(),
  seoDescription: z.string().trim().max(320).optional(),
  canonicalUrl: z.string().trim().max(768).optional(),
  ogImageUrl: z.string().trim().max(768).optional(),
  metaKeywords: z.string().trim().max(500).optional(),
  tags: z.string().trim().max(500).optional(),
});

function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export const blogRouter = router({
  // ===================== Public (used by optional SPA teasers) =====================
  publicListCategories: publicProcedure.query(async () => {
    const categories = await db.listBlogCategories();
    return categories.map(c => ({
      slug: c.slug,
      name: c.name,
      description: c.description,
    }));
  }),

  publicListPosts: publicProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(24).default(9),
        categorySlug: z.string().trim().max(160).optional(),
      })
    )
    .query(async ({ input }) => {
      let categoryId: number | undefined;
      if (input.categorySlug) {
        const category = await db.getBlogCategoryBySlug(input.categorySlug);
        if (!category) return { items: [], total: 0, pageCount: 0 };
        categoryId = category.id;
      }
      const result = await db.listBlogPosts({
        page: input.page,
        pageSize: input.pageSize,
        categoryId,
        publishedOnly: true,
      });
      return {
        items: result.items.map(post => ({
          slug: post.slug,
          title: post.title,
          excerpt: post.excerpt,
          coverImageUrl: post.coverImageUrl,
          categorySlug: post.categorySlug,
          categoryName: post.categoryName,
          publishedAt: post.publishedAt,
          url: `/${post.categorySlug}/${post.slug}`,
        })),
        total: result.total,
        pageCount: result.pageCount,
      };
    }),

  // ===================== Admin: categories =====================
  adminListCategories: adminProcedure.query(async () => {
    const categories = await db.listBlogCategories();
    return Promise.all(
      categories.map(async category => ({
        ...category,
        postCount: await db.countBlogPostsInCategory(category.id),
      }))
    );
  }),

  createCategory: adminProcedure
    .input(categoryInput)
    .mutation(async ({ input }) => {
      const slug = normalizeCategorySlug(input.slug ?? "", input.name);
      const existing = await db.getBlogCategoryBySlug(slug);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A category with this URL already exists",
        });
      }
      const category = await db.createBlogCategory({
        slug,
        name: input.name,
        description: emptyToNull(input.description),
        seoTitle: emptyToNull(input.seoTitle),
        seoDescription: emptyToNull(input.seoDescription),
        sortOrder: input.sortOrder ?? 0,
      });
      invalidateCategorySlugCache();
      return category;
    }),

  updateCategory: adminProcedure
    .input(categoryInput.extend({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const current = await db.getBlogCategoryById(input.id);
      if (!current) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Category not found" });
      }
      const slug = normalizeCategorySlug(input.slug ?? current.slug, input.name);
      const clash = await db.getBlogCategoryBySlug(slug);
      if (clash && clash.id !== input.id) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Another category already uses this URL",
        });
      }
      const category = await db.updateBlogCategory(input.id, {
        slug,
        name: input.name,
        description: emptyToNull(input.description),
        seoTitle: emptyToNull(input.seoTitle),
        seoDescription: emptyToNull(input.seoDescription),
        sortOrder: input.sortOrder ?? current.sortOrder,
      });
      invalidateCategorySlugCache();
      return category;
    }),

  deleteCategory: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const postCount = await db.countBlogPostsInCategory(input.id);
      if (postCount > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Move or delete this category's ${postCount} post(s) before deleting it`,
        });
      }
      await db.deleteBlogCategory(input.id);
      invalidateCategorySlugCache();
      return { ok: true } as const;
    }),

  // ===================== Admin: posts =====================
  adminListPosts: adminProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(5).max(50).default(20),
        search: z.string().trim().max(200).optional(),
        categoryId: z.number().int().positive().optional(),
      })
    )
    .query(({ input }) =>
      db.listBlogPosts({
        page: input.page,
        pageSize: input.pageSize,
        search: input.search,
        categoryId: input.categoryId,
        publishedOnly: false,
      })
    ),

  adminGetPost: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const post = await db.getBlogPostById(input.id);
      if (!post) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Post not found" });
      }
      return post;
    }),

  createPost: adminProcedure.input(postInput).mutation(async ({ input }) => {
    const category = await db.getBlogCategoryById(input.categoryId);
    if (!category) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Choose a valid category",
      });
    }
    const slug = await normalizePostSlug(input.slug ?? "", input.title);
    const post = await db.createBlogPost({
      categoryId: input.categoryId,
      slug,
      title: input.title,
      excerpt: emptyToNull(input.excerpt) ?? excerptFromHtml(input.content),
      content: input.content,
      coverImageUrl: emptyToNull(input.coverImageUrl),
      coverImageAlt: emptyToNull(input.coverImageAlt),
      authorName: emptyToNull(input.authorName),
      status: input.status,
      seoTitle: emptyToNull(input.seoTitle),
      seoDescription: emptyToNull(input.seoDescription),
      canonicalUrl: emptyToNull(input.canonicalUrl),
      ogImageUrl: emptyToNull(input.ogImageUrl),
      metaKeywords: emptyToNull(input.metaKeywords),
      tags: emptyToNull(input.tags),
      publishedAt: input.status === "published" ? new Date() : null,
    });
    return post;
  }),

  updatePost: adminProcedure
    .input(postInput.extend({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const current = await db.getBlogPostById(input.id);
      if (!current) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Post not found" });
      }
      const category = await db.getBlogCategoryById(input.categoryId);
      if (!category) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Choose a valid category",
        });
      }
      const slug = await normalizePostSlug(
        input.slug ?? current.slug,
        input.title,
        input.id
      );
      // Set publishedAt the first time a post becomes published; keep it stable
      // afterwards so re-editing a live post does not reset its publish date.
      let publishedAt = current.publishedAt;
      if (input.status === "published" && !current.publishedAt) {
        publishedAt = new Date();
      } else if (input.status === "draft") {
        publishedAt = current.publishedAt; // preserve original date if any
      }
      const post = await db.updateBlogPost(input.id, {
        categoryId: input.categoryId,
        slug,
        title: input.title,
        excerpt: emptyToNull(input.excerpt) ?? excerptFromHtml(input.content),
        content: input.content,
        coverImageUrl: emptyToNull(input.coverImageUrl),
        coverImageAlt: emptyToNull(input.coverImageAlt),
        authorName: emptyToNull(input.authorName),
        status: input.status,
        seoTitle: emptyToNull(input.seoTitle),
        seoDescription: emptyToNull(input.seoDescription),
        canonicalUrl: emptyToNull(input.canonicalUrl),
        ogImageUrl: emptyToNull(input.ogImageUrl),
        metaKeywords: emptyToNull(input.metaKeywords),
        tags: emptyToNull(input.tags),
        publishedAt,
      });
      return post;
    }),

  deletePost: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await db.deleteBlogPost(input.id);
      return { ok: true } as const;
    }),

  // ===================== Admin: settings =====================
  getSettings: adminProcedure.query(() => db.getBlogSettings()),

  updateSettings: adminProcedure
    .input(
      z.object({
        siteName: z.string().trim().min(1).max(200),
        siteDescription: z.string().trim().max(2000).optional(),
        siteUrl: z.string().trim().max(512).optional(),
        blogTitle: z.string().trim().max(200).optional(),
        adsenseClientId: z.string().trim().max(64).optional(),
        adsenseHeaderCode: z.string().max(20000).optional(),
        adsenseFooterCode: z.string().max(20000).optional(),
        customHeadHtml: z.string().max(20000).optional(),
        customCss: z.string().max(50000).optional(),
        defaultAuthorName: z.string().trim().max(160).optional(),
        postFooterHtml: z.string().max(20000).optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Normalize the AdSense publisher id to the canonical "ca-pub-…" form.
      let adsenseClientId = emptyToNull(input.adsenseClientId);
      if (adsenseClientId) {
        const digits = adsenseClientId.replace(/[^0-9]/g, "");
        adsenseClientId = digits ? `ca-pub-${digits}` : null;
      }
      let siteUrl = emptyToNull(input.siteUrl);
      if (siteUrl) {
        try {
          siteUrl = new URL(siteUrl).origin;
        } catch {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Site URL must be a full URL like https://example.com",
          });
        }
      }
      return db.updateBlogSettings({
        siteName: input.siteName,
        siteDescription: emptyToNull(input.siteDescription),
        siteUrl,
        blogTitle: emptyToNull(input.blogTitle),
        adsenseClientId,
        adsenseHeaderCode: emptyToNull(input.adsenseHeaderCode),
        adsenseFooterCode: emptyToNull(input.adsenseFooterCode),
        customHeadHtml: emptyToNull(input.customHeadHtml),
        customCss: emptyToNull(input.customCss),
        defaultAuthorName: emptyToNull(input.defaultAuthorName),
        postFooterHtml: emptyToNull(input.postFooterHtml),
      });
    }),

  // ===================== Admin: image upload =====================
  uploadImage: adminProcedure
    .input(
      z.object({
        base64Data: z
          .string()
          .min(1, "Image data is empty")
          .max(MAX_IMAGE_BASE64_LENGTH, "Image is too large (max 8 MB)"),
      })
    )
    .mutation(async ({ input }) => {
      const buffer = Buffer.from(input.base64Data, "base64");
      if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Image is empty or too large (max 8 MB)",
        });
      }
      const ext = detectImageExtension(buffer);
      if (!ext) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Unsupported image type. Use JPG, PNG, WebP, or GIF",
        });
      }
      // Store under the public `blog/` namespace (served without auth).
      const relKey = `blog/${new Date().getFullYear()}/image.${ext}`;
      const { url } = await storagePut(relKey, buffer, contentTypeForExt(ext));
      return { url };
    }),
});
