/** Capability URLs are owner-only settings data. Do not put them in public DTOs. */
export function calendarExportUrl(base: string, token: string, destination?: "booking" | "airbnb") {
  if (!base || !/^[0-9a-f]{24}$/.test(token)) return "";
  const filePath = destination === "airbnb" ? "/calendar.ics" : "";
  return `${base.replace(/\/$/, "")}/functions/v1/ical-export${filePath}?token=${token}${destination === "booking" || destination === "airbnb" ? `&destination=${destination}` : ""}`;
}
