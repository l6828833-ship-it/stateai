-- Blog feature: categories, posts, and singleton settings.

DO $$ BEGIN
  CREATE TYPE "blog_post_status" AS ENUM ('draft', 'published');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "blog_categories" (
  "id" serial PRIMARY KEY NOT NULL,
  "slug" varchar(160) NOT NULL,
  "name" varchar(160) NOT NULL,
  "description" text,
  "seoTitle" varchar(200),
  "seoDescription" varchar(320),
  "sortOrder" integer DEFAULT 0 NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "blog_categories_slug_unique" UNIQUE ("slug")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "blog_posts" (
  "id" serial PRIMARY KEY NOT NULL,
  "categoryId" integer NOT NULL,
  "slug" varchar(200) NOT NULL,
  "title" varchar(300) NOT NULL,
  "excerpt" text,
  "content" text NOT NULL,
  "coverImageUrl" varchar(768),
  "coverImageAlt" varchar(300),
  "authorName" varchar(160),
  "status" "blog_post_status" DEFAULT 'draft' NOT NULL,
  "seoTitle" varchar(200),
  "seoDescription" varchar(320),
  "canonicalUrl" varchar(768),
  "ogImageUrl" varchar(768),
  "metaKeywords" varchar(500),
  "tags" text,
  "views" integer DEFAULT 0 NOT NULL,
  "publishedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "blog_posts_slug_unique" UNIQUE ("slug")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "blog_posts_category_idx" ON "blog_posts" ("categoryId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blog_posts_status_published_idx" ON "blog_posts" ("status", "publishedAt");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "blog_settings" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
  "siteName" varchar(200) DEFAULT 'EstateTour Blog' NOT NULL,
  "siteDescription" text,
  "siteUrl" varchar(512),
  "blogTitle" varchar(200),
  "adsenseClientId" varchar(64),
  "adsenseHeaderCode" text,
  "adsenseFooterCode" text,
  "customHeadHtml" text,
  "customCss" text,
  "defaultAuthorName" varchar(160),
  "postFooterHtml" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Seed the singleton settings row.
INSERT INTO "blog_settings" ("id", "siteName", "siteDescription", "blogTitle")
VALUES (1, 'EstateTour Blog', 'Tips, guides, and inspiration for creating cinematic real-estate tour videos.', 'The EstateTour Blog')
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

-- Seed a default category so the blog is usable immediately.
INSERT INTO "blog_categories" ("slug", "name", "description", "sortOrder")
VALUES ('guides', 'Guides', 'How-to guides and best practices for real-estate video tours.', 0)
ON CONFLICT ("slug") DO NOTHING;
