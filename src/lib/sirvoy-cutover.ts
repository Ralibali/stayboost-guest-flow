export type ImportStay = {
  external_id: string;
  room_ref: string;
  unit_id: string;
  guest_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  checkin_date: string;
  checkout_date: string;
  guests: number;
  amount_sek: number | null;
  internal_notes: string;
};

/** RFC 4180, including quoted newlines, BOM and semicolon exports. */
export function readCsv(text: string): Record<string, string>[] {
  const input = text.replace(/^\uFEFF/, "");
  const firstLine = input.split(/\r?\n/, 1)[0];
  const separator =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (quoted || !field) quoted = !quoted;
      else throw new Error("Felaktigt citerat CSV-fält.");
    } else if (c === separator && !quoted) {
      row.push(field);
      field = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) throw new Error("CSV-filen har ett ofullständigt citerat fält.");
  row.push(field);
  if (row.some((v) => v.trim())) rows.push(row);
  const headers =
    rows
      .shift()
      ?.map((h) => h.trim().toLowerCase().replace(/[_.-]/g, " ").replace(/\s+/g, " ").trim()) ?? [];
  if (!headers.length || new Set(headers).size !== headers.length)
    throw new Error("CSV-filen saknar unika kolumnrubriker.");
  return rows.map((values, index) => {
    if (values.length !== headers.length)
      throw new Error(`Rad ${index + 2} har fel antal kolumner.`);
    return Object.fromEntries(headers.map((h, i) => [h, values[i].trim()]));
  });
}

function dateOnly(value: string): string {
  const iso = value.match(/^(\d{4}-\d{2}-\d{2})(?:$|[ T])/);
  const dmy = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  const result =
    iso?.[1] ?? (dmy ? `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}` : "");
  const parsed = new Date(`${result}T12:00:00Z`);
  if (!result || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result)
    throw new Error(`Ogiltigt datum: ${value}`);
  return result;
}
const get = (row: Record<string, string>, ...keys: string[]) =>
  keys.map((k) => row[k]).find(Boolean) ?? "";
const name = (row: Record<string, string>) =>
  get(row, "guest name", "namn") ||
  [get(row, "first name", "förnamn"), get(row, "last name", "efternamn")].filter(Boolean).join(" ");

export function prepareSirvoyImport(
  content: string,
  basic: string,
  mapping: Record<string, string>,
) {
  const rows = readCsv(content);
  if (!rows.length || !("type" in rows[0]) || !("booking no" in rows[0]) || !("room id" in rows[0]))
    throw new Error("Välj Sirvoys Booking content-export med Type, Booking no. och Room ID.");
  const basicRows = basic.trim() ? readCsv(basic) : [];
  if (basicRows.length && !("booking no" in basicRows[0]) && !("bokningsnummer" in basicRows[0]))
    throw new Error("Basic info-exporten måste innehålla bokningsnummer.");
  const contacts = new Map<string, Record<string, string>>();
  for (const row of basicRows) {
    const booking = get(row, "booking no", "bokningsnummer");
    if (!booking || contacts.has(booking))
      throw new Error("Basic info-exporten innehåller ett saknat eller dubblerat bokningsnummer.");
    contacts.set(booking, row);
  }
  const stays: ImportStay[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  const accommodation = rows.filter((r) => r.type.toUpperCase() === "ACCOMM");
  for (const row of accommodation) {
    const booking = get(row, "booking no");
    const room = get(row, "room id");
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(booking) || !/^[A-Za-z0-9_-]+$/.test(room))
        throw new Error("Bokningsnummer eller Room ID saknas.");
      const externalId = `sirvoy-csv:${booking}:${room}`;
      if (seen.has(externalId))
        throw new Error("Flera vistelser för samma bokning och rum måste granskas separat.");
      seen.add(externalId);
      const contact = contacts.get(booking) ?? {};
      const status = (
        get(contact, "status", "booking status", "bokningsstatus") ||
        get(row, "status", "booking status", "bokningsstatus")
      )
        .toLowerCase()
        .replace(/[_-]/g, " ");
      const cancelled = (
        get(contact, "cancelled", "canceled", "avbokad") ||
        get(row, "cancelled", "canceled", "avbokad")
      ).toLowerCase();
      if (
        ["cancelled", "canceled", "avbokad", "annullerad", "deleted"].includes(status) ||
        ["yes", "true", "1", "ja"].includes(cancelled)
      ) {
        warnings.push(`Bokning ${booking}: avbokad och utelämnad ur importen.`);
        continue;
      }
      if (
        status &&
        ![
          "confirmed",
          "bekräftad",
          "reserved",
          "booked",
          "checked in",
          "checked out",
          "incheckad",
          "utcheckad",
        ].includes(status)
      )
        throw new Error(`Bokningsstatus "${status}" måste granskas i Sirvoy före import.`);
      if (!status && !cancelled)
        warnings.push(
          "Exporten anger inte bokningsstatus för alla vistelser. Kontrollera i Sirvoy att endast giltiga bokningar ingår.",
        );
      const checkin = dateOnly(get(row, "check in", "checkin", "incheckning"));
      const checkout = dateOnly(get(row, "check out", "checkout", "utcheckning"));
      if (checkout <= checkin) throw new Error("Avresa måste vara efter ankomst.");
      const guests = Number(get(row, "guests", "antal gäster"));
      if (!Number.isInteger(guests) || guests < 1 || guests > 20)
        throw new Error("Antal gäster saknas eller är ogiltigt.");
      const guestName = name(contact) || name(row);
      if (guestName.length < 2 || guestName.length > 120)
        throw new Error("Gästnamn saknas. Lägg till Basic info-exporten.");
      const email = get(contact, "email", "e post") || get(row, "email", "e post") || null;
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw new Error("Ogiltig e-postadress.");
      const extras = rows.filter(
        (r) => get(r, "booking no") === booking && r.type.toUpperCase() === "EXTRAS",
      );
      if (extras.length)
        warnings.push(
          `Bokning ${booking}: kontrollera barn, tillval och leveransdagar efter importen.`,
        );
      if (!mapping[room]) errors.push(`Rum ${room} måste kopplas till ett boende.`);
      // Keep accommodation totals per stay, never copy the whole booking total
      // to every tent. Payment rows do not establish a new payment assertion.
      const rawAmount = get(row, "total", "belopp").replace(/\s/g, "").replace(",", ".");
      const amount = rawAmount ? Number(rawAmount) : null;
      if (amount !== null && (!Number.isSafeInteger(amount) || amount < 0 || amount > 10000000))
        throw new Error("Boendebeloppet måste vara hela kronor och högst 10 000 000.");
      stays.push({
        external_id: externalId,
        room_ref: room,
        unit_id: mapping[room] ?? "",
        guest_name: guestName,
        guest_email: email,
        guest_phone: get(contact, "phone", "telefon").replace(/^['’]/, "") || null,
        checkin_date: checkin,
        checkout_date: checkout,
        guests,
        amount_sek: amount,
        internal_notes: [
          `Sirvoy ${booking}. Betalning, barn och tillval ska stämmas av mot originalet.`,
          get(contact, "internal note"),
          get(contact, "guest comment"),
          ...extras.map((r) => `${get(r, "specification")} × ${get(r, "units")}`),
        ]
          .filter(Boolean)
          .join("\n"),
      });
    } catch (e) {
      errors.push(`Bokning ${booking || "?"}, rum ${room || "?"}: ${(e as Error).message}`);
    }
  }
  if (!accommodation.length) errors.push("Filen innehåller inga ACCOMM-vistelser.");
  if (stays.length > 2000) errors.push("Importera högst 2 000 vistelser åt gången.");
  return {
    stays,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    rooms: [...new Set(accommodation.map((r) => get(r, "room id")))],
  };
}
