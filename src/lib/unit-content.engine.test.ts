import { readFileSync } from "node:fs";
import { ScriptTarget, transpileModule } from "typescript";
import { expect, it } from "vitest";
import { projectUnitContent } from "../../supabase/functions/_shared/unit-content";
import { collectPages } from "../../supabase/functions/_shared/pagination";
import { stockholmDay } from "../../supabase/functions/_shared/guest-stay";
import { sanitizedHttpsUrl } from "../../supabase/functions/_shared/public-links";
import { channelInventoryFresh } from "../../supabase/functions/_shared/channel-freshness";
import { rulesForUnit } from "../../supabase/functions/_shared/rate-rules";

it("the actual booking GET publishes complete content only through its explicit safe projection", async () => {
  const propertyId = "11111111-1111-1111-1111-111111111111";
  const unitId = "22222222-2222-2222-2222-222222222222";
  const imageId = "44444444-4444-4444-4444-444444444444";
  const privateMarker = "PRIVATE_SOURCE_MARKER";
  const description = " Exact source\n\n" + "Preserve this paragraph. ".repeat(200);
  const fields: Record<string, string> = {};
  const filters: Record<string, [string, unknown][]> = {};
  const rows: Record<string, unknown> = {
    properties: {
      id: propertyId,
      name: "Test property",
      slug: "test",
      booking_enabled: false,
      secret: privateMarker,
    },
    units: [
      {
        id: unitId,
        name: "Old name",
        description: "Old text",
        image_url: "https://example.test/cover.jpg",
        amenities: ["Wifi", "Shower"],
        content_translations: {
          sv: { name: "Swedish", description },
          en: { name: "English", description, source_metadata: privateMarker },
        },
        gallery: [
          { id: imageId, storage_path: `${propertyId}/${unitId}/${imageId}.jpg`, alt_text: "View" },
        ],
        checkin_instructions: privateMarker,
        door_code: privateMarker,
        ical_feed_token: privateMarker,
      },
    ],
    bookings: [
      {
        id: "booking",
        unit_id: unitId,
        checkin_date: "2026-11-01",
        checkout_date: "2026-11-02",
        guest_email: privateMarker,
      },
    ],
  };
  const client = {
    from(table: string) {
      const result = () => ({ data: rows[table] ?? [], error: null });
      const query = {
        select(value: string) {
          fields[table] = value;
          return this;
        },
        eq(field: string, value: unknown) {
          (filters[table] ??= []).push([field, value]);
          return this;
        },
        gte() {
          return this;
        },
        lte() {
          return this;
        },
        order() {
          return this;
        },
        range() {
          return this;
        },
        limit() {
          return this;
        },
        maybeSingle: async () => result(),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return query;
    },
  };
  const source = readFileSync(
    new URL("../../supabase/functions/booking-engine/index.ts", import.meta.url),
    "utf8",
  ).replace(/import[\s\S]*?from\s+["'][^"']+["'];\s*/g, "");
  const code = transpileModule(source, {
    compilerOptions: { target: ScriptTarget.ES2022 },
  }).outputText;
  const bindings = {
    createClient: () => client,
    collectPages,
    stockholmDay,
    sanitizedHttpsUrl,
    channelInventoryFresh,
    rulesForUnit,
    projectUnitContent,
  };
  let handler!: (request: Request) => Promise<Response>;
  new Function("Deno", ...Object.keys(bindings), code)(
    {
      serve: (callback: typeof handler) => {
        handler = callback;
      },
      env: {
        get: (key: string) => (key === "SUPABASE_URL" ? "https://project.supabase.co" : undefined),
      },
    },
    ...Object.values(bindings),
  );
  const response = await handler(new Request("https://example.test/booking-engine?slug=test"));
  expect(response.status).toBe(200);
  const payload = await response.json();
  expect(payload.units[0].contentTranslations).toEqual({
    sv: { name: "Swedish", description },
    en: { name: "English", description },
  });
  expect(payload.units[0].gallery).toEqual([
    {
      id: imageId,
      url: `https://project.supabase.co/storage/v1/object/public/unit-images/${propertyId}/${unitId}/${imageId}.jpg`,
      altText: "View",
    },
  ]);
  expect(JSON.stringify(payload)).not.toContain(privateMarker);
  expect(fields.units).not.toMatch(/door_code|ical_feed_token|checkin_instructions|\*/);
  expect(filters.units).toContainEqual(["property_id", propertyId]);
  expect(filters.units).toContainEqual(["active", true]);
});
