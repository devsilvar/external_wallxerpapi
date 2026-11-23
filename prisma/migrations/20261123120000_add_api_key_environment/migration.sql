-- Track the environment a platform API key was minted for.
-- Existing rows default to 'test' — every key created before this column
-- existed went through the portal default, which is 'test'.

ALTER TABLE "platform_api_keys" ADD COLUMN "environment" VARCHAR(8) NOT NULL DEFAULT 'test';