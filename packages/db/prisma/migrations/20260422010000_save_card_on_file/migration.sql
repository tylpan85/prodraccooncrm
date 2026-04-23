-- =========================================================================
-- Save card on file (Stripe)
--   1. Customer gains stripe_customer_id (created lazily on first card save).
--   2. customer_payment_methods — cards saved in Stripe, referenced by
--      PaymentMethod id; we cache brand/last4/exp to render the UI without
--      hitting Stripe.
--   3. customer_card_requests — tokenized link sent to a client so they
--      enter their card themselves (SetupIntent flow). One row per request;
--      status moves pending → completed via webhook, or expires.
-- =========================================================================

-- Customer: Stripe Customer id (unique within the org).
ALTER TABLE "customers"
  ADD COLUMN "stripe_customer_id" TEXT;

CREATE UNIQUE INDEX "customers_organization_id_stripe_customer_id_key"
  ON "customers"("organization_id", "stripe_customer_id");

-- Saved cards (Stripe PaymentMethod references, cached display fields).
CREATE TABLE "customer_payment_methods" (
    "id"                         UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id"            UUID NOT NULL,
    "customer_id"                UUID NOT NULL,
    "stripe_payment_method_id"   TEXT NOT NULL,
    "brand"                      TEXT,
    "last4"                      TEXT,
    "exp_month"                  INTEGER,
    "exp_year"                   INTEGER,
    "is_default"                 BOOLEAN NOT NULL DEFAULT false,
    "created_at"                 TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                 TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_payment_methods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_payment_methods_stripe_payment_method_id_key"
  ON "customer_payment_methods"("stripe_payment_method_id");

CREATE INDEX "customer_payment_methods_customer_id_idx"
  ON "customer_payment_methods"("customer_id");

CREATE INDEX "customer_payment_methods_organization_id_idx"
  ON "customer_payment_methods"("organization_id");

ALTER TABLE "customer_payment_methods"
  ADD CONSTRAINT "customer_payment_methods_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_payment_methods"
  ADD CONSTRAINT "customer_payment_methods_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Card requests (tokenized links for self-serve entry).
CREATE TABLE "customer_card_requests" (
    "id"                         UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id"            UUID NOT NULL,
    "customer_id"                UUID NOT NULL,
    "token"                      TEXT NOT NULL,
    "status"                     TEXT NOT NULL DEFAULT 'pending',
    "stripe_setup_intent_id"     TEXT,
    "stripe_payment_method_id"   TEXT,
    "expires_at"                 TIMESTAMPTZ(6) NOT NULL,
    "completed_at"               TIMESTAMPTZ(6),
    "created_at"                 TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_card_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_card_requests_token_key"
  ON "customer_card_requests"("token");

CREATE INDEX "customer_card_requests_customer_id_idx"
  ON "customer_card_requests"("customer_id");

CREATE INDEX "customer_card_requests_organization_id_status_idx"
  ON "customer_card_requests"("organization_id", "status");

ALTER TABLE "customer_card_requests"
  ADD CONSTRAINT "customer_card_requests_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_card_requests"
  ADD CONSTRAINT "customer_card_requests_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
