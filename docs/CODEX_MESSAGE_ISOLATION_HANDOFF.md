# StayBoost: scheduled guest message isolation

Date: 2026-09-06

## Work contract

- OWNER: Codex — this bounded implementation and local verification.
- INPUT: `main` at `06806de6e02143a641f10a009734ad618c792c8e`, queue schema/RLS in `20260719000000_fas1.sql`, and open isolation PRs #32, #33, #35, #36 and #37.
- EXPECTED OUTPUT: reject inconsistent property bindings before an automatic guest email or SMS reaches its provider.
- DEFINITION OF DONE: behavioral regression reproduction, safe sender implementation, passing existing repository gates, and a draft PR with explicit limits.
- PROOF: 17 new worker tests; 210 total tests passing; TypeScript, ESLint baseline and production build passing locally.
- NEXT OWNER: Aurora QA to review the isolated change, then Aurora Ventures HQ to coordinate integration with the other isolation candidates.

## Finding

The old `send-scheduled-messages` query joined a booking, its property/unit and a message template using service-role access. It did not select or compare their property bindings before rendering and sending the message.

The schema has independent foreign keys for `scheduled_messages.booking_id` and `template_id`, and for `bookings.property_id` and `unit_id`. Those foreign keys do not require the related objects to belong to the same property. The scheduled-message UPDATE policy checks booking ownership but does not explicitly limit editable columns to cancellation or check template ownership. This PR adds a delivery boundary; it does not modify those database policies.

Synthetic tests reproduced foreign-template delivery in both directions between two properties, foreign-unit content delivery, delivery with a missing property binding, and delivery for a cancelled booking. This is a code-level reproduction, not evidence of an incident involving real guests.

## Implementation

- Move the existing delivery loop to `_shared/scheduled-messages.ts`, with injected clock, environment and provider fetch for direct tests.
- Keep cron authorization in the existing Deno entry point.
- Require matching queue booking/template IDs and matching booking/property/template/unit property IDs before rendering or calling a provider.
- Permit legitimate bookings without an assigned unit.
- Reject bookings that are not confirmed at the time the queue snapshot is read.
- Scope queue updates by message ID, original booking ID, original template ID and pending status. A concurrently reassigned or cancelled queue item is not overwritten.
- Retain the payment gate, contact waiting period and existing email/SMS provider payloads.
- Record a generic `message_scope_invalid` reason without copying foreign content into the error.

The global cron queue intentionally has no single property filter: it serves multiple properties and `scheduled_messages` has no `property_id` column. Each delivery is bound to its booking's property. The test harness uses the real Supabase client against a fake HTTP database with select projection, so omitting scope columns from the production query breaks the tests.

## Validation

- Frozen dependency installation: `bun install --frozen-lockfile` — pass.
- `tsc --noEmit` — pass.
- ESLint plus `scripts/verify-eslint-baseline.mjs` — clean baseline.
- `vitest run` — 22 test files, 210 tests passed, including 17 new worker cases.
- `vite build` — pass.
- `git diff --check` — pass.

Database HTTP and provider calls in the new tests are simulated. No real guest message was sent and no production database was changed. The edge function has not been deployed or exercised in a live Deno environment.

## Integration limits

This is one additional isolation slice, not a go-live decision. It does not replace or merge PRs #32/#33/#35/#36/#37, and its files do not overlap those candidates as checked on 2026-09-06. Sirvoy and the existing payment integrations remain outside this change.

The worker still uses a queue snapshot and does not atomically claim individual deliveries. This PR does not guarantee exactly-once delivery or prevent a cancellation racing after the snapshot from reaching a provider. Existing queue-status write errors also remain outside this isolation change. Database relationship constraints and narrower scheduled-message UPDATE privileges remain follow-up work.

Integration review should verify the Deno wrapper, apply the candidate in the approved test environment, and exercise two test properties with intercepted/test delivery before considering deployment. Keep this PR as a draft until the portfolio's existing release process accepts it.
