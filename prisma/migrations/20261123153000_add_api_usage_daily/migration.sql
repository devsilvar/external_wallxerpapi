-- Per-platform, per-day API request rollup.
-- One row per platform per Africa/Lagos calendar day (stored as UTC midnight).
-- Written by the trackApiUsage middleware after every authenticated partner
-- request. Kept as a rollup rather than a request log: unbounded row growth for
-- a metric that is only ever read at day granularity.

CREATE TABLE "api_usage_daily" (
    "id" TEXT NOT NULL,
    "platform_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "request_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_usage_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "api_usage_daily_platform_id_date_key"
    ON "api_usage_daily"("platform_id", "date");

CREATE INDEX "api_usage_daily_date_idx" ON "api_usage_daily"("date");

ALTER TABLE "api_usage_daily"
    ADD CONSTRAINT "api_usage_daily_platform_id_fkey"
    FOREIGN KEY ("platform_id") REFERENCES "platforms"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
