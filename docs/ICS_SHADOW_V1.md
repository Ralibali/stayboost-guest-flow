# ICS import/export V1 — shadow mode

Candidate architecture on top of `ical_sources` / `ical-sync` / `ical-export`.
Not live to OTAs. Do not merge as a go-live switch without owner gate.

## Libraries (WP-SB-ICAL-LIBS-1)

- **Parse:** kewisch `ical.js` 2.2.1 (MPL-2.0). DATE-only nights stay put; UTC DATE-TIME is converted to `Europe/Stockholm`. Do not add a hand-rolled RFC 5545 parser.
- **Generate:** existing `ics-export.ts` (DATE-only). LAST-MODIFIED is UTC `Z`, STATUS may be `CANCELLED`, lines fold at 75 octets.
- Rejected: `ical-generator`, `node-ical` `fromURL`, `@pipobscure/ical`, `ics-suite`, abandoned `ical`/`icalendar`.

## What this adds

- `calendar_events` with `tenant_id` + `origin_channel`
- `calendar_occupancy` unique `(tenant_id, unit_id, night)` — nights are `[checkin, checkout)`
- `calendar_export_tokens` — 256-bit token, SHA-256 stored, rotatable, revocable, tenant-bound
- `GET /calendar/export/{token}.ics` (app host) and `/functions/v1/calendar-export/{token}.ics`
- Busy VEVENTs only: UID, DATE-only DTSTART/DTEND (Europe/Stockholm), DTSTAMP, LAST-MODIFIED, STATUS, SUMMARY=`busy`
- Import upsert `(tenant_id, channel, unit_id, ical_uid)` with NEW / UPDATED / CANCELLED / REMOVED
- Feed `ETag` / `If-Modified-Since` on `ical_sources`
- Health: `last_fetch`, `last_success`, `last_error`, `HEALTHY` | `FAILED`

## Isolation

`tenant_id` = `properties.id`. The founder property maps to itself. There is no global singleton tenant.

## Loop prevention

Export omits every event whose `origin_channel` equals the token's `destination_channel`.

## What this does not do

- Does **not** push StayBoost feeds to OTAs
- Does **not** cancel Sirvoy bookings when a Sirvoy iCal UID disappears
- Does **not** change Stripe / Brevo / 46elks credentials
- Does **not** weaken `prevent_managed_booking_overlap` on `bookings`
- Does **not** replace live `ical-export?token=` (plaintext `units.ical_feed_token` remains for the existing path)

## LIMITATION — vault gap

No secret vault is provisioned in this environment. Feed URLs remain in `ical_sources.url`, treated as a secrets-style column. Sync and export must never log the URL. At-rest encryption via Vault is a follow-up.

Raw export tokens are never stored, never committed, and never rendered in HTML. Only `token_hash` is persisted.

## Owner gate

Shadow tables can be migrated. Cron / OTA paste of the new export URL stays off until the owner explicitly accepts go-live.
