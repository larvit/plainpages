-- Runs once on first boot (docker-entrypoint-initdb.d), as the POSTGRES_USER.
-- One database per Ory service: each owns its schema and runs its own migrations,
-- so they never collide. A plugin's database does not belong here: bootstrap provisions those on
-- every boot, so one dropped in later is picked up too (README → Plugin storage).
CREATE DATABASE kratos;
CREATE DATABASE keto;
CREATE DATABASE hydra;

-- Postgres grants CONNECT to PUBLIC by default, so every plugin role would otherwise reach the auth
-- plane: table data stays protected, but pg_catalog and the connection slots do not. Ory connects as
-- the POSTGRES_USER, which owns these and keeps its access.
REVOKE CONNECT ON DATABASE kratos FROM PUBLIC;
REVOKE CONNECT ON DATABASE keto FROM PUBLIC;
REVOKE CONNECT ON DATABASE hydra FROM PUBLIC;
