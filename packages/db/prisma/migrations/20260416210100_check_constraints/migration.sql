-- Time-range constraints on schedulable rows
ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_schedule_range_check"
  CHECK (
    ("scheduled_start_at" IS NULL AND "scheduled_end_at" IS NULL)
    OR ("scheduled_end_at" > "scheduled_start_at")
  );

ALTER TABLE "events"
  ADD CONSTRAINT "events_schedule_range_check"
  CHECK ("scheduled_end_at" > "scheduled_start_at");

-- Money sanity
ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_price_cents_nonneg_check"
  CHECK ("price_cents" >= 0);

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_subtotal_nonneg_check"
  CHECK ("subtotal_cents" >= 0);

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_total_nonneg_check"
  CHECK ("total_cents" >= 0);

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_paid_nonneg_check"
  CHECK ("paid_cents" >= 0);

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_amount_due_nonneg_check"
  CHECK ("amount_due_cents" >= 0);

-- Case-insensitive unique service name per org
CREATE UNIQUE INDEX "services_org_name_lower_key"
  ON "services" ("organization_id", lower("name"));
