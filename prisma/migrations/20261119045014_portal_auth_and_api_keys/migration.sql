-- AlterTable
ALTER TABLE "external_admins" ADD COLUMN     "previous_token_hash" VARCHAR(64);

-- AlterTable
ALTER TABLE "platforms" ADD COLUMN     "approval_status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "platform_api_keys" (
    "id" TEXT NOT NULL,
    "platform_id" TEXT NOT NULL,
    "label" VARCHAR(64) NOT NULL DEFAULT 'default',
    "prefix" VARCHAR(16) NOT NULL,
    "key_hash" VARCHAR(64) NOT NULL,
    "created_by_user_id" TEXT,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform_id" TEXT NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_sessions" (
    "id" TEXT NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "ip_address" VARCHAR(64),
    "user_agent" VARCHAR(256),

    CONSTRAINT "portal_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_api_keys_key_hash_key" ON "platform_api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "platform_api_keys_platform_id_idx" ON "platform_api_keys"("platform_id");

-- CreateIndex
CREATE INDEX "platform_api_keys_revoked_at_idx" ON "platform_api_keys"("revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "portal_tokens_token_hash_key" ON "portal_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "portal_tokens_user_id_kind_idx" ON "portal_tokens"("user_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "portal_sessions_token_hash_key" ON "portal_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "portal_sessions_user_id_idx" ON "portal_sessions"("user_id");

-- CreateIndex
CREATE INDEX "portal_sessions_expires_at_idx" ON "portal_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "platforms_approval_status_idx" ON "platforms"("approval_status");

-- AddForeignKey
ALTER TABLE "platform_api_keys" ADD CONSTRAINT "platform_api_keys_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_tokens" ADD CONSTRAINT "portal_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_tokens" ADD CONSTRAINT "portal_tokens_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "platforms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
