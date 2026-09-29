export type LaunchReadiness = {
  stripeConfigured: boolean;
  stripeWebhookConfigured: boolean;
  emailConfigured: boolean;
  smsConfigured: boolean;
  enabledSmsTemplates: number;
};

export function isLaunchReadiness(value: unknown): value is LaunchReadiness {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<LaunchReadiness>;
  return (
    [
      data.stripeConfigured,
      data.stripeWebhookConfigured,
      data.emailConfigured,
      data.smsConfigured,
    ].every((field) => typeof field === "boolean") &&
    Number.isSafeInteger(data.enabledSmsTemplates) &&
    (data.enabledSmsTemplates ?? -1) >= 0
  );
}

export function smsLaunchReadiness(data: LaunchReadiness | null) {
  const required = data != null && data.enabledSmsTemplates > 0;
  return {
    required,
    ok: data != null && (!required || data.smsConfigured),
    label:
      data?.enabledSmsTemplates === 0
        ? "Inga aktiva gästmeddelanden använder SMS"
        : "SMS för aktiva gästmeddelanden anslutet",
  };
}
