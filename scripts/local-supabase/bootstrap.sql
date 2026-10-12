-- The roles and grants a Supabase project starts with, so GoTrue, PostgREST and our migrations run on a plain Postgres.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit password 'local-authenticator';
grant anon, authenticated, service_role to authenticator;
create role supabase_auth_admin login createrole noinherit password 'local-auth-admin';
create schema auth authorization supabase_auth_admin;
grant usage on schema auth to anon, authenticated, service_role;
alter role supabase_auth_admin set search_path = auth;
create schema extensions;
create extension if not exists pgcrypto with schema extensions;
-- Supabase gives the API roles access to everything in public; row level security decides what they see.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
