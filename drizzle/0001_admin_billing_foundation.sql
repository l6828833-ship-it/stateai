CREATE TYPE "public"."account_status" AS ENUM('active', 'disabled');--> statement-breakpoint
ALTER TYPE "public"."plan" ADD VALUE 'starter_monthly';--> statement-breakpoint
ALTER TYPE "public"."plan" ADD VALUE 'creator_monthly';--> statement-breakpoint
ALTER TYPE "public"."plan" ADD VALUE 'studio_monthly';--> statement-breakpoint
ALTER TYPE "public"."plan" ADD VALUE 'starter_yearly';--> statement-breakpoint
ALTER TYPE "public"."plan" ADD VALUE 'creator_yearly';--> statement-breakpoint
ALTER TYPE "public"."plan" ADD VALUE 'studio_yearly';--> statement-breakpoint
CREATE TABLE "admin_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"adminId" integer NOT NULL,
	"targetUserId" integer,
	"action" varchar(96) NOT NULL,
	"metadata" text DEFAULT '{}' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"adminId" integer NOT NULL,
	"delta" integer NOT NULL,
	"reason" varchar(255) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "accountStatus" "account_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sessionVersion" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mustChangePassword" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "resolution" SET DEFAULT '1080p';--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_adminId_users_id_fk" FOREIGN KEY ("adminId") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_targetUserId_users_id_fk" FOREIGN KEY ("targetUserId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_adjustments" ADD CONSTRAINT "usage_adjustments_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_adjustments" ADD CONSTRAINT "usage_adjustments_adminId_users_id_fk" FOREIGN KEY ("adminId") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_admin_created_idx" ON "admin_audit_logs" USING btree ("adminId","createdAt");--> statement-breakpoint
CREATE INDEX "admin_audit_target_created_idx" ON "admin_audit_logs" USING btree ("targetUserId","createdAt");--> statement-breakpoint
CREATE INDEX "usage_adjustment_user_created_idx" ON "usage_adjustments" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "usage_adjustment_admin_created_idx" ON "usage_adjustments" USING btree ("adminId","createdAt");

--> statement-breakpoint
CREATE FUNCTION "public"."prevent_append_only_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'append-only audit records cannot be updated or deleted';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "admin_audit_logs_append_only" BEFORE UPDATE OR DELETE ON "admin_audit_logs" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_append_only_mutation"();--> statement-breakpoint
CREATE TRIGGER "usage_adjustments_append_only" BEFORE UPDATE OR DELETE ON "usage_adjustments" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_append_only_mutation"();
