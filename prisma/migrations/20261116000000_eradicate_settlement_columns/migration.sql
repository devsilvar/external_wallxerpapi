-- Migration: 20261116000000_eradicate_settlement_columns
-- Purpose: Finish AC-08 of the simplification plan. The previous migration
-- (20261115000001) dropped the settlement/Paystack columns from `businesses`
-- but (a) targeted the wrong index name, so the dead DVA index survived, and
-- (b) left the same columns on `users` and the split/settlement columns on
-- `sales_transactions`. This migration removes the remainder.

-- 1. Drop the dead DVA index. The init migration created it as
--    "sales_transactions_business_id_dva_origin_status_idx"; the previous
--    migration tried to drop "idx_sales_business_id_dva_origin_status" and
--    silently no-op'd because of IF EXISTS.
DROP INDEX IF EXISTS "sales_transactions_business_id_dva_origin_status_idx";

-- 2. Drop Paystack / settlement / DVA columns from users.
ALTER TABLE "users"
  DROP COLUMN IF EXISTS "settlement_bank_code",
  DROP COLUMN IF EXISTS "settlement_bank_name",
  DROP COLUMN IF EXISTS "settlement_account_number",
  DROP COLUMN IF EXISTS "settlement_account_name",
  DROP COLUMN IF EXISTS "settlement_connected_at",
  DROP COLUMN IF EXISTS "auto_payout_enabled",
  DROP COLUMN IF EXISTS "paystack_customer_code",
  DROP COLUMN IF EXISTS "virtual_account_number",
  DROP COLUMN IF EXISTS "virtual_account_bank";

-- 3. Drop split / settlement / DVA columns from sales_transactions.
ALTER TABLE "sales_transactions"
  DROP COLUMN IF EXISTS "settled_via_split",
  DROP COLUMN IF EXISTS "split_pct",
  DROP COLUMN IF EXISTS "platform_retained",
  DROP COLUMN IF EXISTS "dva_origin",
  DROP COLUMN IF EXISTS "settled_at";
