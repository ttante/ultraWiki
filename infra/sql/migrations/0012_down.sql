DROP INDEX IF EXISTS idx_generation_jobs_pack_status;
ALTER TABLE generation_jobs DROP COLUMN IF EXISTS degradation_reason;
