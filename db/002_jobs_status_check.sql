-- Existing installations may have been created before submitted jobs were supported.
-- Refresh the status constraint without changing any job data.
ALTER TABLE plow_jobs
  DROP CONSTRAINT IF EXISTS plow_jobs_status_check;

ALTER TABLE plow_jobs
  ADD CONSTRAINT plow_jobs_status_check
  CHECK (status IN ('draft', 'pending', 'active', 'submitted', 'completed', 'rejected', 'expired', 'failed', 'cancelled'));
