-- StayBoost production bootstrap hardening.
-- Close direct RPC execution paths on internal trigger functions and make
-- helper search paths deterministic. No booking/pricing behavior changes.

-- updated_at is a trigger helper; lock resolution to public explicitly.
alter function public.set_updated_at() set search_path = public;

-- owns_property only checks the current authenticated user's ownership.
-- It does not need SECURITY DEFINER; using invoker privileges removes an
-- unnecessary privilege boundary while preserving RLS semantics.
alter function public.owns_property(uuid) security invoker;
alter function public.owns_property(uuid) set search_path = public;

-- These are trigger-only SECURITY DEFINER functions. They must not be callable
-- as public RPC endpoints by anon/authenticated users.
revoke execute on function public.seed_default_templates() from public, anon, authenticated;
revoke execute on function public.generate_booking_messages() from public, anon, authenticated;
