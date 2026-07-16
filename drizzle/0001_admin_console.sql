ALTER TYPE "public"."plan" ADD VALUE IF NOT EXISTS 'starter_monthly';
ALTER TYPE "public"."plan" ADD VALUE IF NOT EXISTS 'starter_yearly';
ALTER TYPE "public"."plan" ADD VALUE IF NOT EXISTS 'creator_monthly';
ALTER TYPE "public"."plan" ADD VALUE IF NOT EXISTS 'creator_yearly';
ALTER TYPE "public"."plan" ADD VALUE IF NOT EXISTS 'studio_monthly';
ALTER TYPE "public"."plan" ADD VALUE IF NOT EXISTS 'studio_yearly';
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "disabledAt" timestamp;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "forcePasswordChange" boolean DEFAULT false NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sessionVersion" integer DEFAULT 0 NOT NULL;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "usageAdjustment" integer DEFAULT 0 NOT NULL;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "usageAdjustmentPeriodEnd" timestamp;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "currentPeriodStart" timestamp;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_audit_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "actorUserId" integer NOT NULL,
  "targetUserId" integer,
  "action" varchar(64) NOT NULL,
  "details" text NOT NULL,
  "ipAddress" varchar(64),
  "userAgent" text,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_logs_created_at_idx" ON "admin_audit_logs" ("createdAt" DESC);
CREATE INDEX IF NOT EXISTS "admin_audit_logs_target_user_idx" ON "admin_audit_logs" ("targetUserId");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_admin_audit_log_changes()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS admin_audit_logs_immutable ON "admin_audit_logs";
CREATE TRIGGER admin_audit_logs_immutable
BEFORE UPDATE OR DELETE ON "admin_audit_logs"
FOR EACH ROW EXECUTE FUNCTION reject_admin_audit_log_changes();
--> statement-breakpoint
DROP TRIGGER IF EXISTS admin_audit_logs_no_truncate ON "admin_audit_logs";
CREATE TRIGGER admin_audit_logs_no_truncate
BEFORE TRUNCATE ON "admin_audit_logs"
FOR EACH STATEMENT EXECUTE FUNCTION reject_admin_audit_log_changes();
