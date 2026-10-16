-- Isolated scaling experiment. Only temporary tables are populated.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL max_parallel_workers_per_gather = 0;

CREATE TEMP TABLE benchmark_bios (id integer, bio text);
CREATE TEMP TABLE benchmark_portfolios (id integer, title text, description text);

INSERT INTO benchmark_bios
SELECT n,
       'Backend engineer builds production APIs. ' || repeat(md5(n::text) || ' ', 4) ||
       CASE WHEN n % 2000 = 0 THEN ' quantumneedle ' ELSE '' END
FROM generate_series(1, 50000) AS n;

INSERT INTO benchmark_portfolios
SELECT n,
       'Portfolio project ' || n ||
       CASE WHEN n % 2000 = 0 THEN ' quantumneedle ' ELSE '' END,
       repeat('Designed tested deployed reliable services. ', 4) || md5(n::text) ||
       CASE WHEN n % 2000 = 0 THEN ' quantumneedle ' ELSE '' END
FROM generate_series(1, 50000) AS n;

ANALYZE benchmark_bios;
ANALYZE benchmark_portfolios;

SELECT 'BEFORE: biography substring search' AS experiment;
SELECT COUNT(*) AS expected_25 FROM benchmark_bios WHERE bio ILIKE '%quantumneedle%';
EXPLAIN (ANALYZE, BUFFERS)
SELECT COUNT(*) FROM benchmark_bios WHERE bio ILIKE '%quantumneedle%';

SELECT 'BEFORE: portfolio title substring search' AS experiment;
SELECT COUNT(*) AS expected_25 FROM benchmark_portfolios WHERE title ILIKE '%quantumneedle%';
EXPLAIN (ANALYZE, BUFFERS)
SELECT COUNT(*) FROM benchmark_portfolios WHERE title ILIKE '%quantumneedle%';

SELECT 'BEFORE: portfolio description substring search' AS experiment;
SELECT COUNT(*) AS expected_25 FROM benchmark_portfolios WHERE description ILIKE '%quantumneedle%';
EXPLAIN (ANALYZE, BUFFERS)
SELECT COUNT(*) FROM benchmark_portfolios WHERE description ILIKE '%quantumneedle%';

CREATE INDEX benchmark_bio_trgm ON benchmark_bios USING GIN (bio gin_trgm_ops);
CREATE INDEX benchmark_title_trgm ON benchmark_portfolios USING GIN (title gin_trgm_ops);
CREATE INDEX benchmark_description_trgm ON benchmark_portfolios USING GIN (description gin_trgm_ops);

ANALYZE benchmark_bios;
ANALYZE benchmark_portfolios;

SELECT 'AFTER: biography substring search' AS experiment;
SELECT COUNT(*) AS expected_25 FROM benchmark_bios WHERE bio ILIKE '%quantumneedle%';
EXPLAIN (ANALYZE, BUFFERS)
SELECT COUNT(*) FROM benchmark_bios WHERE bio ILIKE '%quantumneedle%';

SELECT 'AFTER: portfolio title substring search' AS experiment;
SELECT COUNT(*) AS expected_25 FROM benchmark_portfolios WHERE title ILIKE '%quantumneedle%';
EXPLAIN (ANALYZE, BUFFERS)
SELECT COUNT(*) FROM benchmark_portfolios WHERE title ILIKE '%quantumneedle%';

SELECT 'AFTER: portfolio description substring search' AS experiment;
SELECT COUNT(*) AS expected_25 FROM benchmark_portfolios WHERE description ILIKE '%quantumneedle%';
EXPLAIN (ANALYZE, BUFFERS)
SELECT COUNT(*) FROM benchmark_portfolios WHERE description ILIKE '%quantumneedle%';

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM benchmark_bios WHERE bio ILIKE '%quantumneedle%') <> 25 OR
     (SELECT COUNT(*) FROM benchmark_portfolios WHERE title ILIKE '%quantumneedle%') <> 25 OR
     (SELECT COUNT(*) FROM benchmark_portfolios WHERE description ILIKE '%quantumneedle%') <> 25 THEN
    RAISE EXCEPTION 'Synthetic search results changed';
  END IF;
END $$;

SELECT c.relname, pg_relation_size(c.oid) AS size_bytes
FROM pg_class c
WHERE c.relnamespace = pg_my_temp_schema()
  AND c.relname IN ('benchmark_bio_trgm', 'benchmark_title_trgm', 'benchmark_description_trgm')
ORDER BY c.relname;

ROLLBACK;
