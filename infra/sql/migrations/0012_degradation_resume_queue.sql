ALTER TABLE generation_jobs
  ADD COLUMN IF NOT EXISTS degradation_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_generation_jobs_pack_status
  ON generation_jobs(pack_id, status);
