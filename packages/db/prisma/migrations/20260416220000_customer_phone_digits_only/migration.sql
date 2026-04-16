-- Phase 4: deduplication-by-phone needs a normalized digits-only column.
ALTER TABLE "customer_phones"
  ADD COLUMN "digits_only" TEXT NOT NULL DEFAULT '';

UPDATE "customer_phones"
  SET "digits_only" = regexp_replace(COALESCE("value", ''), '\D', '', 'g');

ALTER TABLE "customer_phones"
  ALTER COLUMN "digits_only" DROP DEFAULT;

CREATE INDEX "customer_phones_digits_only_idx"
  ON "customer_phones" ("digits_only");
