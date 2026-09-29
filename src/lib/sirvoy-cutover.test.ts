import { describe, it, expect } from "vitest";
import { readCsv, prepareSirvoyImport } from "./sirvoy-cutover";
const header =
  "Type,Booking no.,Specification,Room ID,Units,Guests,Check-in,Check-out,Total,First name,Last name";
const stay = "ACCOMM,ABC123,Sjöbris,1,1,2,2027-06-01,2027-06-03,2590,Anna,Andersson";
describe("Sirvoy cutover preview", () => {
  it("reads BOM, semicolons, quotes and newlines without losing guest notes", () => {
    expect(readCsv('\uFEFFA;B\r\n"Gäst; namn";"Två\nRader och ""citat"""')).toEqual([
      { a: "Gäst; namn", b: 'Två\nRader och "citat"' },
    ]);
  });
  it("rejects broken CSV rather than dropping fields", () => {
    expect(() => readCsv("A,B\n1,2,3")).toThrow("fel antal kolumner");
    expect(() => readCsv('A,B\n"unfinished')).toThrow("ofullständigt");
    expect(() => readCsv("A,A\n1,2")).toThrow("unika");
  });
  it("makes room mapping explicit and accepts an optional contact file", () => {
    const noMapping = prepareSirvoyImport(header + "\n" + stay, "", {});
    expect(noMapping.errors).toContain("Rum 1 måste kopplas till ett boende.");
    const ready = prepareSirvoyImport(header + "\n" + stay, "", { "1": "unit-a" });
    expect(ready.errors).toEqual([]);
    expect(ready.stays[0]).toMatchObject({
      external_id: "sirvoy-csv:ABC123:1",
      unit_id: "unit-a",
      guests: 2,
      amount_sek: 2590,
    });
  });
  it("merges contact information without copying the booking total to each tent", () => {
    const contact =
      'Booking no.,First name,Last name,Email,Phone,Total,Internal note\nABC123,Anja,Nilsson,anja@example.com,\'+49170123456,6000,"Glutenfri\nSen ankomst"';
    const two = prepareSirvoyImport(
      header +
        "\n" +
        stay +
        "\n" +
        stay.replace("Sjöbris,1", "Naturkärnan,2").replace("2590", "2795"),
      contact,
      { "1": "a", "2": "b" },
    );
    expect(two.stays.map((s) => s.amount_sek)).toEqual([2590, 2795]);
    expect(two.stays[0]).toMatchObject({
      guest_name: "Anja Nilsson",
      guest_email: "anja@example.com",
      guest_phone: "+49170123456",
    });
    expect(two.stays[0].internal_notes).toContain("Glutenfri\nSen ankomst");
  });
  it("refuses impossible dates, ambiguous duplicate stays and decimal source amounts", () => {
    expect(
      prepareSirvoyImport(header + "\n" + stay.replace("2027-06-01", "2027-02-30"), "", {
        "1": "a",
      }).errors[0],
    ).toContain("Ogiltigt datum");
    expect(
      prepareSirvoyImport(header + "\n" + stay + "\n" + stay, "", { "1": "a" }).errors[0],
    ).toContain("Flera vistelser");
    expect(
      prepareSirvoyImport(header + "\n" + stay.replace("2590", "2590.50"), "", { "1": "a" })
        .errors[0],
    ).toContain("hela kronor");
  });
  it("excludes explicit cancellations and blocks ambiguous status/contact exports", () => {
    const basicHeader = "Booking no.,First name,Last name,Status";
    const cancelled = prepareSirvoyImport(
      header + "\n" + stay,
      basicHeader + "\nABC123,Anna,Andersson,Cancelled",
      { "1": "a" },
    );
    expect(cancelled.stays).toHaveLength(0);
    expect(cancelled.warnings[0]).toContain("avbokad");
    expect(
      prepareSirvoyImport(header + "\n" + stay, basicHeader + "\nABC123,Anna,Andersson,Tentative", {
        "1": "a",
      }).errors[0],
    ).toContain("måste granskas");
    expect(() => prepareSirvoyImport(header + "\n" + stay, "Wrong,File\na,b", {})).toThrow(
      "bokningsnummer",
    );
    expect(() =>
      prepareSirvoyImport(
        header + "\n" + stay,
        basicHeader + "\nABC123,A,B,Confirmed\nABC123,C,D,Confirmed",
        {},
      ),
    ).toThrow("dubblerat");
  });
  it("does not mistake payment or extras rows for accommodation", () => {
    const result = prepareSirvoyImport(
      header +
        "\n" +
        stay +
        "\nEXTRAS,ABC123,Frukost,,4,2,2027-06-01,2027-06-03,836,,\nPAYMENT,ABC123,Stripe,,1,2,2027-06-01,2027-06-03,3426,,",
      "",
      { "1": "a" },
    );
    expect(result.stays).toHaveLength(1);
    expect(result.stays[0].amount_sek).toBe(2590);
    expect(result.stays[0].internal_notes).toContain("Frukost × 4");
    expect(result.warnings.some((w) => w.includes("tillval"))).toBe(true);
  });
});
