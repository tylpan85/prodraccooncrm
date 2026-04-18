-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "archived" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "customers_organization_id_archived_idx" ON "customers"("organization_id", "archived");
