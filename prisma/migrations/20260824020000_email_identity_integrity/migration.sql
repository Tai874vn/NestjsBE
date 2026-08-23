-- Normalize future writes and enforce case-insensitive identity uniqueness without
-- deleting or merging any historical accounts.
CREATE OR REPLACE FUNCTION normalize_and_check_user_email()
RETURNS TRIGGER AS $$
BEGIN
  NEW."email" := LOWER(TRIM(NEW."email"));
  PERFORM pg_advisory_xact_lock(hashtext(NEW."email"));

  IF EXISTS (
    SELECT 1
    FROM "users"
    WHERE LOWER("email") = NEW."email"
      AND id <> COALESCE(NEW.id, 0)
  ) THEN
    RAISE EXCEPTION 'Email address is already registered'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "users_normalize_and_check_email" ON "users";
CREATE TRIGGER "users_normalize_and_check_email"
BEFORE INSERT OR UPDATE OF "email" ON "users"
FOR EACH ROW EXECUTE FUNCTION normalize_and_check_user_email();
