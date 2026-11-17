# Deploy: ESCO occupations

The order matters. Production's database is already migrated (backup
`F:/JobAura_DB_Backups/jobaura-prod-before-esco-occupations-20261116-223837.dump`). Until step 2 is done, creating
or editing a hiring post on prod fails with 400, because the old frontend still sends `careerField`.

Branches: AIService `ai-service-fastapi`, backend and frontend `feat/esco-occupations` (HEAD). The backend has no
new migrations after the prod migration, so the migrator has nothing to apply.

Commands are for Git Bash on the host, from `E:/Final_Year_Project` unless a step says otherwise.

## 1. Restart the AI service on v2

The AI service runs on the Windows host (port 8001), not in Docker. Stop the running uvicorn, then start it from
the branch HEAD (PowerShell):

```powershell
cd E:\Final_Year_Project\AIService
git status                      # on ai-service-fastapi, clean
.\.venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --env-file .env --host 0.0.0.0 --port 8001
```

Check it (Git Bash; `$AI_KEY` is `AI_SERVICE_API_KEY` from the AI service's `.env`):

```bash
curl -s http://127.0.0.1:8001/health
curl -s -X POST http://127.0.0.1:8001/api/v1/predict/resume-seniority \
  -H "Content-Type: application/json" -H "x-ai-service-key: $AI_KEY" \
  -d '{"resume":{"occupation":"2512.3","jobs":[{"title":"Software developer","occupation":"2512.3","start":"2020-01","end":"2024-01"}]}}'
```

- `/health` answers `"status":"healthy"`.
- The seniority call answers with `"model":"jobaura-seniority-structured-v2"` and a label. If it says `-v1`, or
  rejects the `occupation` key, the old service is still running: stop here.

## 2. Deploy backend HEAD and frontend HEAD together

Ship them in one go: the old frontend cannot create posts against the new backend, and the new frontend needs the
backend's `occupationYears`, occupation title and skill-search changes.

```bash
cd E:/clone/NestjsBE && git checkout feat/esco-occupations && git pull --ff-only
cd E:/Final_Year_Project/Frontend/JobAura && git checkout feat/esco-occupations && git pull --ff-only
cd E:/Final_Year_Project
docker compose -p jobaura build migrate backend frontend
docker compose -p jobaura --profile tunnel up -d migrate backend frontend
docker compose -p jobaura logs migrate          # "No pending migrations to apply."
docker compose -p jobaura logs --tail 50 backend
```

## 3. Requeue the AI (back up first)

Only after steps 1 and 2. Back up prod:

```bash
TS=$(date +%Y%m%d-%H%M%S)
docker exec jobaura-postgres-1 pg_dump -U jobaura -d jobaura -Fc -f /tmp/before-requeue-ai.dump
docker cp jobaura-postgres-1:/tmp/before-requeue-ai.dump "F:/JobAura_DB_Backups/jobaura-prod-before-requeue-ai-$TS.dump"
docker exec jobaura-postgres-1 pg_restore -l /tmp/before-requeue-ai.dump | grep -c "TABLE DATA"   # expect 27
```

Run the requeue (it prints counts before and after, and is safe to run again):

```bash
cd E:/clone/NestjsBE
docker exec -i jobaura-postgres-1 psql -U jobaura -d jobaura -v ON_ERROR_STOP=1 < scripts/requeue-ai.sql
```

It requeues hiring posts decided by `jobaura-seniority-structured-v1`, and resumes in NEEDS_INPUT, DONE, FAILED or
AI_UNAVAILABLE (not ones already DONE by v2). Watch the queue drain:

```bash
docker exec jobaura-postgres-1 psql -U jobaura -d jobaura -c 'SELECT "aiStatus", "predictedSeniorityModel", count(*) FROM hiring_posts GROUP BY 1, 2 ORDER BY 1, 2;'
docker exec jobaura-postgres-1 psql -U jobaura -d jobaura -c 'SELECT "aiStatus", "predictedSeniorityModel", count(*) FROM user_resumes GROUP BY 1, 2 ORDER BY 1, 2;'
```

When drained, nothing is QUEUED or PROCESSING and no row says `-v1`. Resumes whose owner has not picked an
occupation stay NEEDS_INPUT until they do; that is expected.

## 4. Optional: load the demo seed (only after the owner says yes)

**This wipes prod content**: all hiring posts, applications, chats, feed and portfolio posts, connections and
notifications. Only non-seed accounts and their resumes are kept. Do not run it without the owner's explicit yes.

The loader (`prisma/seed-realistic.ts`) and its data (`prisma/seed-data/realistic-v2.json`) are local, gitignored
files. Back up first (as in step 3, with a `before-esco-seed` name), then:

```bash
cd E:/clone/NestjsBE
SEED_CONFIRM=wipe-demo-data \
DATABASE_URL="postgresql://jobaura:<prod password>@127.0.0.1:5433/jobaura?schema=public" \
npx ts-node prisma/seed-realistic.ts
```

The seed creates its resumes and posts as QUEUED, so the worker levels them with v2. If the owner says no, step 3
is what moves the 60 existing prod posts off their v1 levels.

## 5. Smoke checks

- `curl -s http://127.0.0.1:8001/health` is healthy, and the backend logs show no AI errors.
- Recruiter: create a hiring post with an occupation (for example web developer) and a specialty; it saves (no 400)
  and gets a level within a minute.
- Recruiter: open posts filtered by occupation load.
- Candidates page: filter by web developer with "include related" on; ICT business analyst and software developer
  candidates appear. The years filter label reads "Years as web developer".
- Candidate: open the resume form; the main occupation, its years and the "Related experience" lines show (no
  "counted when you save" for a saved resume). Save it; the level comes back with model v2.
- Recommended jobs show the occupation title on each card.
- At 390 px width, the post form, open posts and candidates pages do not scroll sideways.
