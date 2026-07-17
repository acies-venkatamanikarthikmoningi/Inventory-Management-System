-- Runs once, only on first container startup (empty data volume), via Postgres's
-- docker-entrypoint-initdb.d mechanism. Creates the Fill Rate module's OWN database
-- on the same Postgres container as `inventory` (infra simplicity) while keeping the
-- two schemas/data fully separate (no shared schema, no cross-database references).
CREATE DATABASE fill_rate_db;
