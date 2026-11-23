-- Operator admins get their own email/password identity and browser sessions.
-- Until now an "admin" was a developer User row with role = 'admin', which let
-- one login reach both the developer portal and the admin console. Admins are
-- now a separate identity: external_admins rows, never developer accounts.

ALTER TABLE "external_admins" ADD COLUMN "email" VARCHAR(255);
ALTER TABLE "external_admins" ADD COLUMN "password_hash" TEXT;

CREATE UNIQUE INDEX "external_admins_email_key" ON "external_admins"("email");

CREATE TABLE "admin_sessions" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "ip_address" VARCHAR(64),
    "user_agent" VARCHAR(256),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_sessions_token_hash_key" ON "admin_sessions"("token_hash");
CREATE INDEX "admin_sessions_admin_id_idx" ON "admin_sessions"("admin_id");
CREATE INDEX "admin_sessions_expires_at_idx" ON "admin_sessions"("expires_at");

ALTER TABLE "admin_sessions"
    ADD CONSTRAINT "admin_sessions_admin_id_fkey"
    FOREIGN KEY ("admin_id") REFERENCES "external_admins"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
