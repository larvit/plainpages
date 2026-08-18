-- Runs once on first boot (docker-entrypoint-initdb.d), as the POSTGRES_USER.
-- One database per Ory service: each owns its schema and runs its own migrations,
-- so they never collide. A plugin's database does not belong here: bootstrap provisions those on
-- every boot, so one dropped in later is picked up too (README → Plugin storage).
CREATE DATABASE kratos;
CREATE DATABASE keto;
CREATE DATABASE hydra;
