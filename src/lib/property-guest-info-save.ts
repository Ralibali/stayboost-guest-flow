import type { SupabaseClient } from "@supabase/supabase-js";
import type { Property } from "./supabase";
import type { GuestInfoTranslations } from "../../supabase/functions/_shared/property-guest-info";

export type PropertyGuestInfoSnapshot = {
  directions: string | null;
  house_rules: string | null;
  guest_info_translations: GuestInfoTranslations;
};

export function propertyGuestInfoSnapshot(
  property: Pick<Property, "directions" | "house_rules" | "guest_info_translations">,
): PropertyGuestInfoSnapshot {
  return {
    directions: property.directions,
    house_rules: property.house_rules,
    guest_info_translations: structuredClone(property.guest_info_translations ?? {}),
  };
}

export async function savePropertyGuestInfoDraft(
  client: SupabaseClient,
  propertyId: string,
  original: PropertyGuestInfoSnapshot,
  draft: PropertyGuestInfoSnapshot,
): Promise<boolean> {
  const { data, error } = await client.rpc("save_property_guest_info", {
    p_property_id: propertyId,
    p_original: original,
    p_draft: draft,
  });
  if (error) throw error;
  return data === true;
}

/** Only fields edited by this Settings form; separate editors keep their own save boundaries. */
export function propertySettingsPatch(property: Property) {
  return {
    name: property.name,
    checkin_time: property.checkin_time,
    checkout_time: property.checkout_time,
    slug: property.slug,
    wifi_name: property.wifi_name,
    wifi_password: property.wifi_password,
    booking_terms_url: property.booking_terms_url,
    contact_phone: property.contact_phone,
    review_url: property.review_url,
    swish_number: property.swish_number,
    swish_hold_minutes: property.swish_hold_minutes,
    chat_enabled: property.chat_enabled,
    chat_email: property.chat_email,
    chat_title: property.chat_title,
    chat_greeting: property.chat_greeting,
    chat_color: property.chat_color,
    chat_position: property.chat_position,
    chat_button_label: property.chat_button_label,
  };
}
