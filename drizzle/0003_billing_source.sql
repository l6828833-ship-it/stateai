ALTER TABLE "subscriptions"
ADD COLUMN IF NOT EXISTS "billingSource" varchar(16) DEFAULT 'stripe' NOT NULL;
