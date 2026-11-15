-- Migration: 20261115000001_simplify_external_api
-- Purpose: Eradicate over-engineered Paystack settlement and external device tokens.
-- Target surface: External B2B API

-- 1. Drop unused Paystack, DVA, split, and settlement columns from businesses
ALTER TABLE "businesses"
  DROP COLUMN IF EXISTS "paystack_customer_code",
  DROP COLUMN IF EXISTS "virtual_account_number",
  DROP COLUMN IF EXISTS "virtual_account_bank",
  DROP COLUMN IF EXISTS "paystack_subaccount_code",
  DROP COLUMN IF EXISTS "settlement_bank_code",
  DROP COLUMN IF EXISTS "settlement_bank_name",
  DROP COLUMN IF EXISTS "settlement_account_number",
  DROP COLUMN IF EXISTS "settlement_account_name",
  DROP COLUMN IF EXISTS "platform_commission_pct",
  DROP COLUMN IF EXISTS "settlement_connected_at",
  DROP COLUMN IF EXISTS "auto_split_enabled",
  DROP COLUMN IF EXISTS "tax_split_percentage",
  DROP COLUMN IF EXISTS "dva_failure_reason",
  DROP COLUMN IF EXISTS "dva_failed_at",
  DROP COLUMN IF EXISTS "voucher_bonus_pct",
  DROP COLUMN IF EXISTS "voucher_adjustment_threshold",
  DROP COLUMN IF EXISTS "payout_change_permitted",
  DROP COLUMN IF EXISTS "payout_change_permitted_at",
  DROP COLUMN IF EXISTS "payout_change_permitted_by",
  DROP COLUMN IF EXISTS "payout_change_used_at",
  DROP COLUMN IF EXISTS "marketplace_slot_allowance";

-- 2. Drop dead index on sales_transactions (dva_origin was only used for split settlement)
DROP INDEX IF EXISTS "idx_sales_business_id_dva_origin_status";

-- 3. Drop external devices table
DROP TABLE IF EXISTS "external_devices";
