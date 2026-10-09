-- The updated_at trigger function ran with whatever search_path its caller had. It only calls
-- now(), which lives in pg_catalog, so pinning an empty search_path changes nothing it does and
-- removes any chance of it resolving a look-alike object from another schema.
alter function app.set_updated_at() set search_path = '';
