-- =========================================================================
-- Phase 1: Invoices module foundations
--   1. Organization gains address/phone/website (used as company header on
--      invoice PDFs and the public pay link).
--   2. New PaymentMethod catalog (per-org, like LeadSource), with optional
--      reference label (e.g. Zelle "Transaction #") and a stripe vs manual
--      source.
--   3. New InvoicePayment table — one row per payment; the user explicitly
--      ruled out partial payments, but the table is amount-aware so we have
--      a clean record + room for refunds later.
--   4. New OrgIntegration table for Stripe / RingCentral configuration
--      (one row per (org, kind)).
--   5. Invoice gains: publicToken (anonymous pay link), lastSentVia /
--      lastSentAt (drives reopen → draft vs sent decision), Stripe
--      identifiers, lockedAt (set when paid via Stripe → invoice + job
--      become immutable), and company snapshots for PDF stability.
-- =========================================================================

-- New enums
CREATE TYPE "PaymentSource" AS ENUM ('manual', 'stripe');
CREATE TYPE "IntegrationKind" AS ENUM ('stripe', 'ringcentral');

-- Organization: company header fields
ALTER TABLE "organizations"
  ADD COLUMN "address" TEXT,
  ADD COLUMN "phone"   TEXT,
  ADD COLUMN "website" TEXT;

-- Payment method catalog (per-org)
CREATE TABLE "payment_methods" (
    "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name"            TEXT NOT NULL,
    "source"          "PaymentSource" NOT NULL DEFAULT 'manual',
    "reference_label" TEXT,
    "active"          BOOLEAN NOT NULL DEFAULT true,
    "order_index"     INTEGER NOT NULL DEFAULT 0,
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_methods_organization_id_name_key"
  ON "payment_methods"("organization_id", "name");

CREATE INDEX "payment_methods_organization_id_active_idx"
  ON "payment_methods"("organization_id", "active");

ALTER TABLE "payment_methods"
  ADD CONSTRAINT "payment_methods_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Org integration config (Stripe / RingCentral / future)
CREATE TABLE "org_integrations" (
    "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "kind"            "IntegrationKind" NOT NULL,
    "enabled"         BOOLEAN NOT NULL DEFAULT false,
    "config"          JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "org_integrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "org_integrations_organization_id_kind_key"
  ON "org_integrations"("organization_id", "kind");

ALTER TABLE "org_integrations"
  ADD CONSTRAINT "org_integrations_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Invoice payment ledger
CREATE TABLE "invoice_payments" (
    "id"                          UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id"             UUID NOT NULL,
    "invoice_id"                  UUID NOT NULL,
    "payment_method_id"           UUID,
    "payment_method_name_snapshot" TEXT NOT NULL,
    "source"                      "PaymentSource" NOT NULL DEFAULT 'manual',
    "amount_cents"                INTEGER NOT NULL,
    "reference"                   TEXT,
    "paid_at"                     TIMESTAMPTZ(6) NOT NULL,
    "recorded_by_user_id"         UUID,
    "stripe_charge_id"            TEXT,
    "stripe_payment_intent_id"    TEXT,
    "created_at"                  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "invoice_payments_invoice_id_idx"
  ON "invoice_payments"("invoice_id");

CREATE INDEX "invoice_payments_organization_id_paid_at_idx"
  ON "invoice_payments"("organization_id", "paid_at");

ALTER TABLE "invoice_payments"
  ADD CONSTRAINT "invoice_payments_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoice_payments"
  ADD CONSTRAINT "invoice_payments_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invoice_payments"
  ADD CONSTRAINT "invoice_payments_payment_method_id_fkey"
  FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoice_payments"
  ADD CONSTRAINT "invoice_payments_recorded_by_user_id_fkey"
  FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Invoice: new columns
ALTER TABLE "invoices"
  ADD COLUMN "public_token"                 TEXT,
  ADD COLUMN "last_sent_via"                TEXT,
  ADD COLUMN "last_sent_at"                 TIMESTAMPTZ(6),
  ADD COLUMN "stripe_checkout_session_id"   TEXT,
  ADD COLUMN "stripe_payment_intent_id"     TEXT,
  ADD COLUMN "locked_at"                    TIMESTAMPTZ(6),
  ADD COLUMN "company_name_snapshot"        TEXT,
  ADD COLUMN "company_address_snapshot"     TEXT,
  ADD COLUMN "company_phone_snapshot"       TEXT,
  ADD COLUMN "company_website_snapshot"     TEXT;

-- Backfill publicToken for existing invoices (uuid hex, no dashes)
UPDATE "invoices"
SET "public_token" = REPLACE(gen_random_uuid()::text, '-', '')
                  || REPLACE(gen_random_uuid()::text, '-', '')
WHERE "public_token" IS NULL;

ALTER TABLE "invoices"
  ALTER COLUMN "public_token" SET NOT NULL;

CREATE UNIQUE INDEX "invoices_public_token_key"
  ON "invoices"("public_token");

-- Seed default payment methods for every existing organization.
-- (Idempotent: skipped if a method with the same name already exists.)
INSERT INTO "payment_methods"
  ("id", "organization_id", "name", "source", "reference_label", "active", "order_index", "created_at", "updated_at")
SELECT
  gen_random_uuid(), o."id", v.name, v.source::"PaymentSource", v.reference_label, true, v.order_index,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "organizations" o
CROSS JOIN (VALUES
  ('Zelle',       'manual', 'Transaction #', 0),
  ('Venmo',       'manual', NULL,            1),
  ('Check',       'manual', 'Check #',       2),
  ('Cash',        'manual', NULL,            3),
  ('Credit Card', 'stripe', NULL,            4)
) AS v(name, source, reference_label, order_index)
ON CONFLICT ("organization_id", "name") DO NOTHING;
