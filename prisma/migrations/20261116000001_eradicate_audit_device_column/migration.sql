-- AC-08: the audit trail no longer carries a device identifier. Device tokens
-- were removed together with the external_devices table, so this column has been
-- written as NULL ever since and nothing reads it.
ALTER TABLE "audit_logs" DROP COLUMN IF EXISTS "external_device_id";
