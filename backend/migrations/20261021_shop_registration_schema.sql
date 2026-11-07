-- Shop registration schema migration.
-- Safe to run repeatedly; existing shop records and columns are preserved.

ALTER TABLE Shop
  ADD COLUMN IF NOT EXISTS alternateMobile VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS email VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS paymentTerms VARCHAR(120) NULL,
  ADD COLUMN IF NOT EXISTS submittedAt DATETIME NULL,
  ADD COLUMN IF NOT EXISTS reviewedAt DATETIME NULL,
  ADD COLUMN IF NOT EXISTS reviewedById VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS reviewReason VARCHAR(1000) NULL,
  ADD COLUMN IF NOT EXISTS retailerCode VARCHAR(80) NULL,
  ADD COLUMN IF NOT EXISTS brVerificationStatus VARCHAR(40) NULL,
  ADD COLUMN IF NOT EXISTS updatedAt DATETIME NULL;

CREATE INDEX IF NOT EXISTS idx_shop_tenant_status_created
  ON Shop (tenantId, status, createdAt);

CREATE INDEX IF NOT EXISTS idx_shop_tenant_salesperson
  ON Shop (tenantId, assignedSalespersonId);
