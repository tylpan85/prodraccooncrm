-- CreateTable
CREATE TABLE "job_service_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "service_id" UUID,
    "order_index" INTEGER NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "name_snapshot" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "job_service_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_service_items_job_id_order_index_idx" ON "job_service_items"("job_id", "order_index");

-- AddForeignKey
ALTER TABLE "job_service_items" ADD CONSTRAINT "job_service_items_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_service_items" ADD CONSTRAINT "job_service_items_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "invoice_line_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "order_index" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoice_line_items_invoice_id_order_index_idx" ON "invoice_line_items"("invoice_id", "order_index");

-- AddForeignKey
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one JobServiceItem per existing job that has a service or a non-zero price
INSERT INTO "job_service_items" ("id", "job_id", "service_id", "order_index", "price_cents", "name_snapshot", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  j."id",
  j."service_id",
  0,
  j."price_cents",
  NULL,
  j."created_at",
  j."updated_at"
FROM "jobs" j
WHERE j."service_id" IS NOT NULL OR j."price_cents" > 0;

-- Backfill: one InvoiceLineItem per existing invoice, from snapshot fields
INSERT INTO "invoice_line_items" ("id", "invoice_id", "description", "price_cents", "order_index", "created_at")
SELECT
  gen_random_uuid(),
  i."id",
  COALESCE(NULLIF(i."service_name_snapshot", ''), 'Service'),
  COALESCE(i."service_price_cents_snapshot", i."subtotal_cents"),
  0,
  i."created_at"
FROM "invoices" i;
