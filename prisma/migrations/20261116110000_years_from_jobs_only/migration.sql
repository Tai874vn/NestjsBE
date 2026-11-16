-- Years in a field are counted only from the start and end months of the resume's jobs; the typed-in
-- YearsExperience number is dropped. Resumes that had one are queued so the AI level uses the counted years.
UPDATE user_resumes
SET data = data - 'YearsExperience',
    "aiStatus" = 'QUEUED',
    "aiStatusMessage" = NULL,
    "aiQueuedAt" = CURRENT_TIMESTAMP,
    "aiClaimedAt" = NULL,
    "aiAttempts" = 0
WHERE data ? 'YearsExperience';
