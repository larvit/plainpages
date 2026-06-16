-- Runs once on first boot (docker-entrypoint-initdb.d), as the POSTGRES_USER.
-- One database per Ory service: each owns its schema and runs its own migrations,
-- so they never collide. The web app never connects here (stateless — see README).
CREATE DATABASE kratos;
CREATE DATABASE keto;
CREATE DATABASE hydra;
