export type ChannelConnection = {
  id: string;
  property_id: string;
  provider: "channex";
  environment: "staging" | "production";
  external_property_id: string;
  enabled: boolean;
  fees_configured: boolean;
  verified_at: string | null;
  webhook_id: string | null;
  last_booking_sync_at: string | null;
  last_ari_sync_at: string | null;
  last_error: string | null;
  sync_dirty_at: string | null;
  next_retry_at: string | null;
};
export type ChannelMapping = {
  id: string;
  connection_id: string;
  unit_id: string;
  room_type_id: string;
  rate_plan_id: string;
};
export type ChannelRevision = {
  revision_id: string;
  connection_id: string;
  status: "pending_mapping" | "applied" | "stale";
  created_at: string;
  last_error: string | null;
  acknowledged_at: string | null;
};
export function channelStatus(
  connection: ChannelConnection,
  pending: number,
  mapped: number,
  activeUnits: number,
  now = Date.now(),
) {
  if (pending > 0 || connection.last_error)
    return { label: "Behöver åtgärd", tone: "amber" } as const;
  if (!connection.verified_at || !connection.webhook_id || mapped < activeUnits || mapped === 0)
    return { label: "Konfigurera kopplingen", tone: "amber" } as const;
  if (!connection.enabled) return { label: "Pausad", tone: "neutral" } as const;
  const timestamps = [connection.last_booking_sync_at, connection.last_ari_sync_at];
  if (
    timestamps.some(
      (time, index) =>
        !time ||
        !Number.isFinite(Date.parse(time)) ||
        now - Date.parse(time) > (index === 0 ? 5 * 60000 : 26 * 3600000),
    )
  )
    return { label: "Inväntar färsk synkning", tone: "amber" } as const;
  return { label: "Teknisk synk verifierad", tone: "green" } as const;
}
export function channelError(error: { message?: string } | string): string {
  const message = typeof error === "string" ? error : (error.message ?? "");
  const labels: Record<string, string> = {
    disable_channel_before_mapping: "Pausa kopplingen innan du ändrar rums- och priskopplingar.",
    disable_channel_before_edit: "Pausa kopplingen innan du byter miljö eller anläggnings-ID.",
    channel_not_verified: "Verifiera rum och prisplaner först.",
    channel_inventory_changed:
      "Kalendern ändrades under synkningen. Kanalförsäljningen har stängts tillfälligt; kör synkningen igen.",
    channel_inventory_conflict:
      "En kanalbokning överlappar en befintlig bokning. Kontrollera båda bokningarna och lös kollisionen innan försäljningen öppnas igen.",
    channel_inventory_closure_failed:
      "Kanalförsäljningen kunde inte bekräftas stängd. Kontrollera kanalerna och kör synkningen igen innan nya bokningar tas emot.",
    channel_sync_completion_failed:
      "Synkningen kunde inte bekräftas färdig. Uppdatera status och försök igen när den pågående synkningen har avslutats.",
    channel_webhook_required: "Registrera bokningsaviseringar först.",
    channel_mapping_incomplete: "Koppla alla aktiva boenden till ett rum och en prisplan först.",
    invalid_channel_unit: "Boendet måste tillhöra den här anläggningen.",
    channex_not_configured: "Channex API-nyckel saknas på servern för den valda miljön.",
    channex_webhook_not_configured:
      "Hemligheten för bokningsaviseringar saknas på servern för den valda miljön.",
    channel_child_policy_not_verified:
      "Kontrollera barnavgifter och åldersgränser i varje kanal och bekräfta avgiftsupplägget innan du verifierar.",
    channel_mapping_changed:
      "Kopplingen har ändrats under verifieringen. Uppdatera och verifiera på nytt.",
    channel_mapping_required:
      "Mottagna kanalbokningar saknar rumskoppling. Kontrollera rums-ID och synka igen.",
    channel_child_fee_mismatch:
      "Barnavgiften i Channex stämmer inte med StayBoost. Ändra prisplanen innan synkning.",
    channel_rate_model_unsupported:
      "Prisplanens prismodell stämmer inte med boendets vuxenpriser. Kontrollera prismodellen hos Channex.",
    channel_property_not_authorized:
      "Anläggningen behöver en godkänd serverkoppling till rätt Channex-konto. Be ansvarig för integrationen kontrollera kopplingen.",
    channel_capacity_mismatch:
      "Kapaciteten i Channex stämmer inte med tältets gästantal. Varje fysiskt tält ska ha ett eget rum med antal 1.",
    channel_currency_mismatch:
      "Anläggningen och prisplanerna i Channex ska använda svenska kronor, SEK.",
    channel_fees_not_configured:
      "Kontrollera och bekräfta avgifter och barnregler i varje kanal innan synkning.",
    channel_inventory_window_unsupported:
      "Channex kalenderfönster ska vara 365–730 dagar. Justera inställningen hos Channex.",
    channel_min_stay_model_unsupported:
      "Channex ska tillämpa minsta vistelse över hela vistelsen. Välj through eller both i anläggningens inställningar.",
    channel_occupancy_model_unsupported:
      "Prisalternativen i Channex ska täcka exakt de vuxenantal som tältet tillåter.",
    channel_positive_rate_required:
      "Alla öppna datum behöver ett giltigt positivt pris. Kontrollera priser och stängda perioder.",
    channel_rate_inheritance_unsupported:
      "Den kopplade prisplanen ska ha egna manuella priser. En ärvd prisplan stöds inte av den här kopplingen.",
    channel_rate_mapping_mismatch:
      "Prisplanens ID hör inte till det kopplade rummet. Kontrollera rum och prisplan hos Channex.",
    channel_room_mapping_mismatch:
      "Rums-ID hör inte till den kopplade Channex-anläggningen. Kontrollera mappningen.",
    channel_unit_mapping_mismatch:
      "Boendekopplingarna stämmer inte med de aktiva tälten. Kontrollera varje rumskoppling.",
    channel_booking_backlog:
      "Det finns fler kanalhändelser att läsa in. Kör synkningen igen och öppna försäljningen när hela kön är inläst.",
    channel_feed_not_advancing:
      "Kanalens händelsekö går inte vidare. Kontrollera incidenterna och försök synka igen.",
    channel_ack_record_failed:
      "Bokningen är sparad men mottagningskvittot kunde inte registreras. Synka igen; bokningen ska inte skapas dubbelt.",
    channel_lease_failed:
      "En pågående synkning kunde inte bekräftas. Vänta en kort stund och försök igen.",
    channel_version_check_failed:
      "Kalenderns aktuella version kunde inte verifieras. Försäljningen öppnas när en ny synkning lyckas.",
    channel_revision_save_failed:
      "En kanalbokning kunde inte sparas. Kontrollera incidenten och synka igen innan försäljningen öppnas.",
    channel_storage_error:
      "Kanalinformationen kunde inte sparas eller läsas. Uppdatera status och försök igen.",
    channel_data_limit:
      "Kalenderunderlaget är större än vad kopplingen kan hantera. Be ansvarig för integrationen kontrollera underlaget.",
    channex_api_error: "Channex avvisade förfrågan. Kontrollera kopplingen och försök igen.",
    channex_invalid_response:
      "Channex skickade ett svar som inte kunde verifieras. Försök synka igen.",
    channex_network_error: "Channex kunde inte nås. Försök igen när anslutningen fungerar.",
    channex_pagination_limit:
      "Channex händelsekö blev inte färdig inom gränsen. Kontrollera kön och fortsätt synka innan försäljningen öppnas.",
    channex_partial_update:
      "Channex kunde inte bekräfta hela kalenderuppdateringen. Kontrollera kanalerna och kör en full synkning igen.",
    channex_rate_limited:
      "Channex begränsar tillfälligt antalet anrop. Kopplingen försöker igen efter en kort väntan.",
  };
  return (
    (Object.entries(labels).find(([code]) => message.includes(code))?.[1] ??
      "Kopplingen kunde inte uppdateras. Läs in status och försök igen.") ||
    "Åtgärden kunde inte slutföras."
  );
}
