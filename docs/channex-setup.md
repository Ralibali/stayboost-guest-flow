# Channex adapter setup

The adapter is prepared locally and starts disabled. No partner account, staging
certification, production channel contract or live credential has been provided.
Passing local tests does not establish that Booking.com, Airbnb, BookVisit or
Google are connected.

## Server credentials and ownership

Keep API credentials and webhook secrets in Supabase Edge Function secrets.
Use separate values for staging and production:

- `CHANNEX_STAGING_API_KEY` / `CHANNEX_PRODUCTION_API_KEY`
- `CHANNEX_STAGING_WEBHOOK_SECRET` / `CHANNEX_PRODUCTION_WEBHOOK_SECRET`
- `CHANNEX_STAGING_PROPERTY_BINDINGS` / `CHANNEX_PRODUCTION_PROPERTY_BINDINGS`

The bindings are JSON objects mapping a Stayboost property UUID to its approved
external Channex property UUID. An example with placeholders is
`{"<Stayboost property UUID>":"<Channex property UUID>"}`. The platform operator
must establish this binding; customers cannot authorize an arbitrary property
under a shared platform API key. Connections without a matching server binding
make no Channex API requests.

An individual connection may override its environment's shared API key through
`CHANNEX_<ENVIRONMENT>_CONNECTION_<CONNECTION_UUID>_API_KEY`, with UUID hyphens
replaced by underscores and all letters uppercase. Its property binding is still
required. A generic `CHANNEX_API_KEY` is accepted only when `CHANNEX_ENVIRONMENT`
explicitly selects the connection's environment.

The callback uses an environment-specific shared-secret header. Channex has no
built-in webhook HMAC. Notifications are wakeups: the backend retrieves the
authoritative revision from Channex, sanitizes it, saves it atomically and only
then acknowledges it. Card guarantees, CVV, addresses and arbitrary metadata are
excluded from persisted payloads and browser responses.

## Configure and certify

1. Deploy the channel migration, `channel-sync` and `channex-webhook` functions.
   Both functions verify their own authorization; their gateway JWT setting is
   disabled. `channel-sync` requires the signed-in property owner or the existing
   cron secret. The webhook requires its environment's secret header.
2. Create a staging connection in **Kanaler** and map every active physical tent
   to a separate Channex room type with inventory count **1**, plus its rate plan.
   The first implementation requires a unique room type per physical unit.
3. Verify SEK currency, room capacity and minimum-stay model `through` or `both`.
   The Channex inventory window must be 365–730 days. The adapter synchronizes
   that entire window and closes dates beyond Stayboost's 365-day booking horizon.
4. Flat room prices use `per_room`, `manual` and a single maximum-occupancy option.
   Occupancy prices use `per_person`, `manual` and options for each adult count
   from 1 through maximum occupancy. Inherited or derived rates are rejected.
   Adult rates use Stayboost's canonical monthly, weekend and date-rule pricing.
5. Configure cleaning fees and children/infant policies in every channel and
   explicitly attest them in Kanaler. The API verifies children fee equals the
   Stayboost nightly child fee and infant fee is zero. Age limits and channel
   capacity policies require partner/channel verification; the checkbox is an
   operational attestation, not proof supplied by the API.
6. Verify mappings, register booking notifications, explicitly enable the
   connection and run a full synchronization. Mapping changes require pausing and
   invalidate verification. Registering a webhook is safe to retry.
7. Complete Channex staging certification: create, modify, cancel, multiroom,
   duplicate and delayed revisions; payment hints; unmapped rooms; overlapping
   bookings; transient API failure; retry and acknowledgement; restriction/rate
   consistency and inventory recovery. Review actual channels before cutover.
8. Run `supabase/cron/register-channel-jobs.sql` only after credentials and
   certification are ready. It uses the existing Vault URL and cron secret and
   schedules minute batches. The adapter retries failures with backoff, keeps
   concurrent changes dirty and performs a daily full inventory refresh.

During outgoing synchronization, a short database lease prevents local inventory
writes from racing the external inventory snapshot. Remote inventory is closed
while revisions are drained and rates are refreshed. Version checks before and
after reopening detect concurrent revisions and retry safely. Unresolved incoming
revisions persist as pending incidents and block new local reservations. Operator
attention is required for conflicts, mapping failures and uncertain closure.
Enabled connections also block local reservations and inventory changes until a
complete booking feed has succeeded within five minutes and a full ARI update
within 26 hours. The initial synchronization can run while this gate is closed.

## Channel-specific cutover limitations

Channex lists `BOK` for BookVisit/Citybreak/Nozio. The iframe channel list does not
include BOK; confirm availability and connection procedure with the partner and
account before promising BookVisit support.

Channex's Google Hotel Centre requires its Instant Booking Page. Using Stayboost's
own booking engine for Google needs an approved Hotel Centre arrangement; the
standard partner integration does not establish this permission. The Google
Vacation Rental path has separate requirements. Resolve the appropriate product
and agreement before activating it for glamping.

Sirvoy CSV cutover imports are owned by Stayboost after import. Existing live
Sirvoy/iCal/Channex bookings remain controlled by their source until the explicit
cutover is complete. Do not enable two independent owners of the same channel
inventory. Export, reconcile bookings and verify channel counts before switching.

## Official protocol references

- [API reference](https://docs.channex.io/api-v.1-documentation/api-reference)
- [ARI and partial-update warnings](https://docs.channex.io/api-v.1-documentation/ari)
- [Booking revision feed and acknowledgement](https://docs.channex.io/api-v.1-documentation/bookings-collection)
- [Webhook authentication, events and retries](https://docs.channex.io/api-v.1-documentation/webhook-collection)
- [Rate plans and occupancy options](https://docs.channex.io/api-v.1-documentation/rate-plans-collection)
- [Room types and capacity](https://docs.channex.io/api-v.1-documentation/room-types-collection)
- [Property settings](https://docs.channex.io/api-v.1-documentation/hotels-collection/get-property-api)
- [Best practices](https://docs.channex.io/guides/best-practices-guide)
- [Channel codes](https://docs.channex.io/api-v.1-documentation/channel-codes)
- [Google connection requirements](https://docs.channex.io/google/google-hotel-ads)
