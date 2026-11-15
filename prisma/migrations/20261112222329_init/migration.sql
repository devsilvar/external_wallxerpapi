-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('user', 'admin');

-- CreateEnum
CREATE TYPE "BusinessRole" AS ENUM ('owner', 'manager', 'sales_staff', 'accountant', 'viewer');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('confirmed', 'completed', 'pending', 'reversed', 'disputed');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'sent', 'paid', 'overdue', 'cancelled');

-- CreateEnum
CREATE TYPE "InvoicePaymentMethod" AS ENUM ('cash', 'bank_transfer', 'pos', 'card', 'mobile_money', 'cheque', 'online', 'other');

-- CreateEnum
CREATE TYPE "SalesSource" AS ENUM ('bank_transfer', 'paycode', 'pos', 'online_store', 'manual', 'cash', 'invoice', 'credit', 'store_voucher', 'api', 'card', 'mobile_money', 'ussd', 'cheque', 'other');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('bad_debt', 'bank_charges', 'communication', 'depreciation', 'fuel', 'gift', 'insurance', 'interest', 'inventory', 'logistics', 'marketing', 'office_supplies', 'other', 'professional_fees', 'rent', 'repairs_maintenance', 'salary', 'subscription', 'tax_permit', 'travel', 'utility', 'power', 'statutory_contributions', 'staff_welfare', 'training', 'security', 'licenses_permits');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "password_hash" TEXT,
    "phone" TEXT,
    "full_name" TEXT,
    "bvn_encrypted" TEXT,
    "bvn_hash" VARCHAR(64),
    "nin_encrypted" TEXT,
    "nin_hash" VARCHAR(64),
    "bvn_verified_at" TIMESTAMP(3),
    "nin_verified_at" TIMESTAMP(3),
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "verification_token_hash" TEXT,
    "verification_token_expires_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "reset_token_expires_at" TIMESTAMP(3),
    "reset_token_hash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'user',
    "transaction_pin" TEXT,
    "pin_attempts" INTEGER NOT NULL DEFAULT 0,
    "pin_locked_until" TIMESTAMP(3),
    "pin_attempts_reset_at" TIMESTAMP(3),
    "pin_set_at" TIMESTAMP(3),
    "regulatory_terms_accepted_at" TIMESTAMP(3),
    "regulatory_terms_version" TEXT,
    "settlement_bank_code" TEXT,
    "settlement_bank_name" TEXT,
    "settlement_account_number" TEXT,
    "settlement_account_name" TEXT,
    "settlement_connected_at" TIMESTAMP(3),
    "auto_payout_enabled" BOOLEAN NOT NULL DEFAULT false,
    "paystack_customer_code" TEXT,
    "virtual_account_number" TEXT,
    "virtual_account_bank" TEXT,
    "primary_business_id" TEXT,
    "subscription_tier" TEXT DEFAULT 'free',
    "subscription_expires_at" TIMESTAMP(3),
    "trial_ends_at" TIMESTAMP(3),
    "acquisition_source" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "businesses" (
    "id" TEXT NOT NULL,
    "platform_id" TEXT NOT NULL,
    "external_customer_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "business_name" TEXT NOT NULL,
    "owner_name" TEXT NOT NULL,
    "tax_id" TEXT,
    "business_type" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "contact_phone" TEXT,
    "contact_email" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "subscription_expires_at" TIMESTAMP(3),
    "paystack_customer_code" TEXT,
    "virtual_account_number" TEXT,
    "virtual_account_bank" TEXT,
    "default_profit_margin" DECIMAL(5,2) NOT NULL DEFAULT 20.00,
    "tax_reminder_day" INTEGER NOT NULL DEFAULT 25,
    "paystack_subaccount_code" TEXT,
    "settlement_bank_code" TEXT,
    "settlement_bank_name" TEXT,
    "settlement_account_number" TEXT,
    "settlement_account_name" TEXT,
    "platform_commission_pct" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "settlement_connected_at" TIMESTAMP(3),
    "auto_split_enabled" BOOLEAN NOT NULL DEFAULT false,
    "tax_split_percentage" DECIMAL(5,2) NOT NULL DEFAULT 7.50,
    "dva_failure_reason" TEXT,
    "dva_failed_at" TIMESTAMP(3),
    "logo_url" TEXT,
    "logo_public_id" TEXT,
    "payout_change_permitted" BOOLEAN NOT NULL DEFAULT false,
    "payout_change_permitted_at" TIMESTAMP(3),
    "payout_change_permitted_by" TEXT,
    "payout_change_used_at" TIMESTAMP(3),
    "voucher_bonus_pct" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "voucher_adjustment_threshold" DECIMAL(15,2) NOT NULL DEFAULT 50000.00,
    "marketplace_slot_allowance" INTEGER NOT NULL DEFAULT 3,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "merchant_id" TEXT NOT NULL,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_members" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "BusinessRole" NOT NULL DEFAULT 'viewer',
    "permissions" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "tax_id" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "voucher_bonus_pct" DECIMAL(5,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_transactions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "source" "SalesSource" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'confirmed',
    "reference_id" TEXT NOT NULL,
    "description" TEXT,
    "customer_name" TEXT,
    "transaction_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,
    "metadata" JSONB,
    "settled_via_split" BOOLEAN NOT NULL DEFAULT false,
    "split_pct" DECIMAL(5,2),
    "platform_retained" DECIMAL(15,2),
    "needs_verification" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(3),
    "verified_by" TEXT,
    "customer_hint" TEXT,
    "final_classification" TEXT,
    "is_taxable" BOOLEAN NOT NULL DEFAULT true,
    "dva_origin" BOOLEAN NOT NULL DEFAULT false,
    "settled_at" TIMESTAMP(3),
    "customer_id" TEXT,

    CONSTRAINT "sales_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_line_items" (
    "id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(15,2) NOT NULL,
    "line_total" DECIMAL(15,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "external_ref" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "category_detail" TEXT,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(15,2),
    "expense_date" DATE NOT NULL,
    "receipt_url" TEXT,
    "is_deductible" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "external_ref" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
    "issue_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "sent_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "customer_name" TEXT NOT NULL,
    "customer_email" TEXT,
    "customer_phone" TEXT,
    "customer_address" TEXT,
    "customer_tax_id" TEXT,
    "subtotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "notes" TEXT,
    "payment_terms" TEXT,
    "pdf_url" TEXT,
    "linked_sale_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,
    "payment_method" "InvoicePaymentMethod",
    "share_token" TEXT,
    "share_token_expires_at" TIMESTAMP(3),

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(15,2) NOT NULL,
    "line_total" DECIMAL(15,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "platform_id" TEXT,
    "external_device_id" TEXT,
    "actor" TEXT NOT NULL,
    "user_id" TEXT,
    "business_id" TEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "old_data" JSONB,
    "new_data" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platforms" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "suspended_at" TIMESTAMP(3),
    "suspended_reason" TEXT,
    "flat_fee_ngn" DECIMAL(12,2),
    "subscription_expires_at" TIMESTAMP(3),
    "api_key_hash" VARCHAR(64),
    "api_key_prefix" VARCHAR(16),
    "api_key_last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platforms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_devices" (
    "id" TEXT NOT NULL,
    "platform_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "code_hash" VARCHAR(64),
    "code_expires_at" TIMESTAMP(3),
    "code_attempts" INTEGER NOT NULL DEFAULT 0,
    "token_hash" VARCHAR(64),
    "expires_at" TIMESTAMP(3),
    "device_name" TEXT,
    "device_platform" TEXT,
    "activated_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "last_seen_ip" TEXT,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_tombstones" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_tombstones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_sequences" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "external_sequences_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "external_admins" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "expires_at" TIMESTAMP(3),
    "allowed_ips" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_admins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_phone_idx" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_bvn_hash_idx" ON "users"("bvn_hash");

-- CreateIndex
CREATE INDEX "users_nin_hash_idx" ON "users"("nin_hash");

-- CreateIndex
CREATE INDEX "users_verification_token_hash_idx" ON "users"("verification_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "businesses_tax_id_key" ON "businesses"("tax_id");

-- CreateIndex
CREATE UNIQUE INDEX "businesses_merchant_id_key" ON "businesses"("merchant_id");

-- CreateIndex
CREATE INDEX "businesses_user_id_idx" ON "businesses"("user_id");

-- CreateIndex
CREATE INDEX "businesses_tax_id_idx" ON "businesses"("tax_id");

-- CreateIndex
CREATE INDEX "businesses_payout_change_permitted_by_idx" ON "businesses"("payout_change_permitted_by");

-- CreateIndex
CREATE UNIQUE INDEX "businesses_platform_id_external_customer_id_key" ON "businesses"("platform_id", "external_customer_id");

-- CreateIndex
CREATE INDEX "business_members_user_id_idx" ON "business_members"("user_id");

-- CreateIndex
CREATE INDEX "business_members_business_id_role_idx" ON "business_members"("business_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "business_members_business_id_user_id_key" ON "business_members"("business_id", "user_id");

-- CreateIndex
CREATE INDEX "customers_business_id_name_idx" ON "customers"("business_id", "name");

-- CreateIndex
CREATE INDEX "customers_business_id_phone_idx" ON "customers"("business_id", "phone");

-- CreateIndex
CREATE INDEX "customers_business_id_is_active_idx" ON "customers"("business_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "customers_business_id_external_id_key" ON "customers"("business_id", "external_id");

-- CreateIndex
CREATE INDEX "sales_transactions_business_id_updated_at_id_idx" ON "sales_transactions"("business_id", "updated_at", "id");

-- CreateIndex
CREATE INDEX "sales_transactions_business_id_transaction_date_idx" ON "sales_transactions"("business_id", "transaction_date" DESC);

-- CreateIndex
CREATE INDEX "sales_transactions_reference_id_idx" ON "sales_transactions"("reference_id");

-- CreateIndex
CREATE INDEX "sales_transactions_source_idx" ON "sales_transactions"("source");

-- CreateIndex
CREATE INDEX "sales_transactions_customer_id_idx" ON "sales_transactions"("customer_id");

-- CreateIndex
CREATE INDEX "sales_transactions_business_id_dva_origin_status_idx" ON "sales_transactions"("business_id", "dva_origin", "status");

-- CreateIndex
CREATE INDEX "idx_sales_needs_verification" ON "sales_transactions"("business_id", "needs_verification");

-- CreateIndex
CREATE INDEX "idx_sales_unverified_queue" ON "sales_transactions"("needs_verification", "transaction_date" DESC);

-- CreateIndex
CREATE INDEX "idx_sales_tax_calc" ON "sales_transactions"("business_id", "status", "is_taxable", "transaction_date", "amount");

-- CreateIndex
CREATE UNIQUE INDEX "sales_transactions_business_id_source_reference_id_key" ON "sales_transactions"("business_id", "source", "reference_id");

-- CreateIndex
CREATE INDEX "sale_line_items_sale_id_sort_order_idx" ON "sale_line_items"("sale_id", "sort_order");

-- CreateIndex
CREATE INDEX "expenses_business_id_updated_at_id_idx" ON "expenses"("business_id", "updated_at", "id");

-- CreateIndex
CREATE INDEX "expenses_business_id_expense_date_idx" ON "expenses"("business_id", "expense_date" DESC);

-- CreateIndex
CREATE INDEX "expenses_category_idx" ON "expenses"("category");

-- CreateIndex
CREATE INDEX "expenses_business_id_is_deductible_idx" ON "expenses"("business_id", "is_deductible");

-- CreateIndex
CREATE INDEX "idx_expense_tax_calc" ON "expenses"("business_id", "is_deductible", "expense_date", "amount");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_business_id_external_ref_key" ON "expenses"("business_id", "external_ref");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_linked_sale_id_key" ON "invoices"("linked_sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_share_token_key" ON "invoices"("share_token");

-- CreateIndex
CREATE INDEX "invoices_business_id_updated_at_id_idx" ON "invoices"("business_id", "updated_at", "id");

-- CreateIndex
CREATE INDEX "invoices_business_id_issue_date_idx" ON "invoices"("business_id", "issue_date" DESC);

-- CreateIndex
CREATE INDEX "invoices_business_id_created_at_idx" ON "invoices"("business_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "invoices_business_id_status_idx" ON "invoices"("business_id", "status");

-- CreateIndex
CREATE INDEX "invoices_customer_id_idx" ON "invoices"("customer_id");

-- CreateIndex
CREATE INDEX "invoices_due_date_idx" ON "invoices"("due_date");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_business_id_external_ref_key" ON "invoices"("business_id", "external_ref");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_business_id_invoice_number_key" ON "invoices"("business_id", "invoice_number");

-- CreateIndex
CREATE INDEX "invoice_lines_invoice_id_sort_order_idx" ON "invoice_lines"("invoice_id", "sort_order");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_business_id_created_at_idx" ON "audit_logs"("business_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE UNIQUE INDEX "platforms_owner_user_id_key" ON "platforms"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "platforms_api_key_hash_key" ON "platforms"("api_key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "external_devices_code_hash_key" ON "external_devices"("code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "external_devices_token_hash_key" ON "external_devices"("token_hash");

-- CreateIndex
CREATE INDEX "external_devices_platform_id_business_id_idx" ON "external_devices"("platform_id", "business_id");

-- CreateIndex
CREATE INDEX "external_devices_business_id_revoked_at_idx" ON "external_devices"("business_id", "revoked_at");

-- CreateIndex
CREATE INDEX "external_tombstones_business_id_created_at_id_idx" ON "external_tombstones"("business_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "external_admins_token_hash_key" ON "external_admins"("token_hash");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_primary_business_id_fkey" FOREIGN KEY ("primary_business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_transactions" ADD CONSTRAINT "sales_transactions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_transactions" ADD CONSTRAINT "sales_transactions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_line_items" ADD CONSTRAINT "sale_line_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_linked_sale_id_fkey" FOREIGN KEY ("linked_sale_id") REFERENCES "sales_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
