-- Trigger functions are not public RPC endpoints. Trigger execution still works.
revoke all on function public.reconcile_journey_template_queue() from public, anon, authenticated;
