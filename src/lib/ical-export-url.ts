/** Capability URLs are owner-only settings data. Do not put them in public DTOs. */
export function calendarExportUrl(base: string, token: string, destination?: "booking") {
  if (!base || !/^[0-9a-f]{24}$/.test(token)) return "";
  return `${base.replace(/\/$/, "")}/functions/v1/ical-export?token=${token}${destination === "booking" ? "&destination=booking" : ""}`;
}
