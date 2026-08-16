-- The demo-mode RPCs (run_demo_cue from this phase, seed_demo_org and
-- wipe_demo_org from Phase 1) each end with `revoke all on function ...
-- from public`, which is correct -- SECURITY DEFINER functions must not be
-- callable by arbitrary authenticated users -- but none of them re-grant
-- EXECUTE to service_role. The demo-ops edge function calls all three via
-- the service-role client (deps.admin.rpc(...)), so without this grant every
-- call fails at runtime with 42501 permission denied for function, even
-- though the function bodies are correct. pgTAP never caught this because it
-- runs as the postgres superuser, which bypasses grants entirely.
grant execute on function public.run_demo_cue(uuid, text, uuid) to service_role;
grant execute on function public.seed_demo_org(uuid, text, uuid) to service_role;
grant execute on function public.wipe_demo_org(uuid) to service_role;
