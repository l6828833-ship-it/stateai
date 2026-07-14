CREATE TYPE "public"."auth_purpose" AS ENUM('signup', 'login', 'reset');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('starter', 'pro', 'annual', 'business');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."tour_style" AS ENUM('Walkthrough', 'Drone', 'Cinematic');--> statement-breakpoint
CREATE TABLE "auth_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(320) NOT NULL,
	"codeHash" varchar(128) NOT NULL,
	"purpose" "auth_purpose" NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"consumedAt" timestamp,
	"attempts" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" integer NOT NULL,
	"userId" integer NOT NULL,
	"status" "job_status" DEFAULT 'processing' NOT NULL,
	"tourStyle" "tour_style" NOT NULL,
	"resolution" varchar(16) NOT NULL,
	"aspectRatio" varchar(8) NOT NULL,
	"clipDuration" integer NOT NULL,
	"imageSequence" text,
	"optimizedPrompt" text,
	"openrouterJobId" varchar(128),
	"videoKey" varchar(512),
	"videoUrl" varchar(768),
	"thumbnailUrl" varchar(768),
	"errorMessage" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" integer NOT NULL,
	"userId" integer NOT NULL,
	"sequenceIndex" integer NOT NULL,
	"fileKey" varchar(512) NOT NULL,
	"url" varchar(768) NOT NULL,
	"fileName" varchar(255),
	"mimeType" varchar(64),
	"roomTag" varchar(64),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"name" varchar(255) DEFAULT 'My Property Tour' NOT NULL,
	"tourStyle" "tour_style" DEFAULT 'Walkthrough' NOT NULL,
	"creativeText" text,
	"resolution" varchar(16) DEFAULT '720p' NOT NULL,
	"aspectRatio" varchar(8) DEFAULT '16:9' NOT NULL,
	"clipDuration" integer DEFAULT 5 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"stripeCustomerId" varchar(128),
	"stripeSubscriptionId" varchar(128),
	"plan" "plan",
	"status" varchar(32) DEFAULT 'inactive' NOT NULL,
	"currentPeriodEnd" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"passwordHash" varchar(255),
	"emailVerified" timestamp,
	"role" "role" DEFAULT 'user' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
