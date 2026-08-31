type AdminLike = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

export async function isCronAuthorized(
  admin: AdminLike,
  secret: string | null | undefined,
): Promise<boolean> {
  if (!secret) return false;

  // Keep backwards compatibility with an explicitly configured Edge Function secret.
  const envSecret = Deno.env.get("CRON_SECRET");
  if (envSecret && secret === envSecret) return true;

  // Production bootstrap can keep the raw secret only in Supabase Vault.
  // Edge Functions validate it through a service-role-only SHA-256 verifier RPC,
  // so no raw cron secret has to be committed or exposed through PostgREST.
  const { data, error } = await admin.rpc("verify_ops_cron_secret", {
    p_secret: secret,
  });
  if (error) {
    console.error("Cron auth verification failed:", error.message ?? "unknown error");
    return false;
  }

  return data === true;
}
