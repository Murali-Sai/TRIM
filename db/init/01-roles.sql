-- Local development roles. Runs once, when the Docker volume is first created.
-- trim (POSTGRES_USER) owns the schema and runs migrations.
-- trim_app holds table privileges; the migration grants them. It never owns tables and has
-- no BYPASSRLS, so row-level security always applies to it.
-- trim_api is the login the API uses; it inherits trim_app.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'trim_app') THEN
    CREATE ROLE trim_app NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'trim_api') THEN
    CREATE ROLE trim_api LOGIN NOBYPASSRLS PASSWORD 'trim_api' IN ROLE trim_app;
  END IF;
END
$$;
