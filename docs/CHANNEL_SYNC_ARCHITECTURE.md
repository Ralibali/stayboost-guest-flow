# StayBoost — Channel Sync Architecture

## Goal

The customer should not have to think about calendar synchronization.

StayBoost must converge booking/availability state across connected sources without making browser automation the sole safety mechanism.

## Connector priority

For each channel choose the most reliable available method in this order:

1. Official API / certified connectivity
2. Official webhook / callback + API
3. Existing channel-manager callback/API
4. iCal import/export
5. Structured reservation email ingestion where legally/operationally appropriate
6. Browser automation as a supervised fallback for unsupported workflows
7. Manual intervention

Browser automation is useful for filling gaps, checking state and handling low-frequency unsupported actions. It must not be the only protection against double bookings because UI changes, MFA, bot protection and session failures can stop it.

## Canonical model

StayBoost should maintain one normalized reservation ledger while preserving the external source.

Every external reservation should retain at minimum:

- `property_id`
- `unit_id`
- `source` (`direct`, `sirvoy`, `booking`, `airbnb`, `expedia`, `ical`, `manual`, etc.)
- `external_reservation_id` when available
- source calendar/connection id
- arrival/departure
- status
- guest count where available
- external updated timestamp where available
- last_seen_at
- normalized fingerprint/hash
- sync status
- raw-source reference sufficient for debugging without unnecessarily storing sensitive payloads

Use a unique identity strategy such as `(connection_id, external_reservation_id)` where possible and a deterministic fingerprint for weaker sources such as iCal.

## Safety rule

When uncertain, protect inventory first.

If two sources disagree and StayBoost cannot prove availability safely:

- block the affected unit/date
- flag the conflict
- retry/reconcile
- alert the operator only if automation cannot resolve it

Never silently open inventory because one source temporarily disappeared.

## Reconciliation loop

A periodic reconciliation worker should compare expected external state with StayBoost state.

Suggested baseline:

- event/webhook updates immediately where supported
- lightweight reconciliation every 5–15 minutes for active connections
- slower full reconciliation periodically
- forced reconciliation after connector recovery or credential change

Each run records:

- started/finished
- connection
- rows/events read
- creates/updates/cancellations
- conflicts
- errors
- retry count
- last successful sync

## Idempotency

Every write path must tolerate repeats.

Repeated webhook, iCal event or browser-observed reservation must not create a duplicate booking.

Use deterministic keys/upserts and transactional conflict checks.

## Cancellation and disappearance

Never equate one missing fetch with a confirmed cancellation.

Use source-specific rules:

- explicit API cancellation → update promptly
- iCal event marked cancelled → update according to source semantics
- event merely absent from one fetch → require confirmation/grace/reconciliation before releasing inventory

## Connector states

Expose a simple health model:

- CONNECTED
- SYNCING
- HEALTHY
- DEGRADED
- AUTH_REQUIRED
- ERROR
- PAUSED

Dashboard should show the action, not technical noise.

Example:

> Booking.com has not synchronized for 42 minutes. Inventory remains protected. Reconnect account.

## Browser automation fallback

Allowed uses:

- verify external calendar state
- low-frequency administrative updates unsupported elsewhere
- collect evidence for a reconciliation discrepancy
- assist onboarding/connection steps where terms and platform controls permit

Requirements:

- isolated credentials/session handling
- no secrets in repo/logs/prompts
- explicit audit log
- screenshot/state verification where useful
- bounded retries
- MFA/auth-required state escalates rather than loops
- never bypass platform security controls
- never be the only mechanism that decides a date is safe to sell

## Booking.com strategy

Treat direct Booking.com Connectivity as a strategic track, not an assumption. Official connectivity requires provider permissions/connections and go-live requirements/certification for relevant APIs.

Therefore the product can ship and sell in stages:

### Stage A — works alongside existing PMS/channel manager

- direct booking
- iCal sync
- Sirvoy/existing-manager integration
- guest automation
- upsells
- daily operations
- reconciliation and alerts

### Stage B — stronger channel adapters

- callbacks/webhooks where available
- richer reservation metadata
- price/availability push through supported partner interfaces

### Stage C — certified direct OTA connectivity

- Booking.com and other direct channel integrations where business volume justifies certification/partnership work

Do not block product-market validation on Stage C.

## Source-of-truth modes

Support an explicit per-property transition model:

1. `EXTERNAL_PRIMARY` — Sirvoy/other PMS remains source of truth; StayBoost augments operations/revenue.
2. `STAYBOOST_PRIMARY` — StayBoost owns direct inventory and pushes/synchronizes outward through verified connectors.
3. `HYBRID_TRANSITION` — controlled migration with conflict protection and rollback.

Never change source-of-truth mode implicitly.

## Test matrix

Every connector should be tested against:

- new reservation
- changed arrival
- changed departure
- changed unit
- cancellation
- duplicate delivery
- out-of-order delivery
- temporary timeout
- auth failure
- malformed payload
- source returns empty calendar
- overlapping booking
- same-day checkout/check-in
- timezone/DST boundary
- long stay
- retry after outage

## Business KPI

The channel platform is successful when:

- double-booking incidents = 0
- sync success is high and observable
- manual interventions/property decline
- onboarding time declines
- connected-channel count grows
- customers trust StayBoost enough to make it part of daily operations
