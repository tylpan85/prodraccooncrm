-- CreateIndex
CREATE INDEX "recurring_series_organization_id_recurrence_enabled_recurre_idx" ON "recurring_series"("organization_id", "recurrence_enabled", "recurrence_end_mode", "materialization_horizon_until");
