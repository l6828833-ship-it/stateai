ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "checkoutReservationKey" varchar(128);
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "checkoutPlanId" varchar(64);
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "checkoutReservedAt" timestamp;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "checkoutExpiresAt" timestamp;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "checkoutSessionId" varchar(128);
