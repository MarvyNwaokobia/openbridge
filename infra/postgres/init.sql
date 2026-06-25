-- OpenBridge — Postgres bootstrap
-- Built for the Interledger Open Payments Accelerator 2026.
--
-- The default `openbridge` database (created by POSTGRES_DB) holds OpenBridge
-- application data. Rafiki's backend and auth servers each need their own
-- database on the same instance; create them here.

CREATE DATABASE rafiki_backend;
CREATE DATABASE rafiki_auth;

GRANT ALL PRIVILEGES ON DATABASE rafiki_backend TO openbridge;
GRANT ALL PRIVILEGES ON DATABASE rafiki_auth TO openbridge;
