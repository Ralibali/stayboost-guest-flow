# Link existing source holds before native iCal import

This procedure preserves an existing Sirvoy calendar booking. It does not create
an additional stay, assert payment, enable guest communication, or turn on sales.
The function is service-only and checks the supplied actor against the property's
current owner. There is no browser binding endpoint.

1. Keep direct sales closed. Create the native Booking.com source on the correct
   physical unit **paused**. Do not run the importer first. Activation is rejected
   while that unit has unbound future Booking.com source holds.
2. Read the actual native calendar and retain its bytes privately. Record the
   observed UID and exclusive checkout date. Independently link that event to the
   actual Booking.com reservation reference using the native feed or Booking.com
   extranet. A matching date, guest name, or assumed UID pattern is insufficient.
3. Prepare the following exact evidence object from those observations. The two
   evidence hashes identify files retained by the reviewing operator. The RPC
   does **not** fetch a provider or prove the contents of those files. Never use
   placeholder hashes or inferred provider references for a live call.

| Field                           | Verified source                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------- |
| `provider_reference`            | Booking.com reservation reference; must equal the immutable condensed CSV's `Channel booking ID`  |
| `sirvoy_booking_reference`      | Source row's Sirvoy booking reference                                                             |
| `native_event_uid`              | Exact UID actually present in the native feed                                                     |
| `checkin_date`, `checkout_date` | Observed event dates, `YYYY-MM-DD`, checkout exclusive; must equal the unchanged source hold      |
| `observed_at`                   | Timestamp of this observation; at most 24 hours old                                               |
| `feed_sha256`                   | SHA-256 of the retained native feed bytes                                                         |
| `feed_url_sha256`               | SHA-256 of the exact configured source URL's UTF-8 bytes; URL itself is not copied into the audit |
| `reference_evidence_sha256`     | SHA-256 of retained evidence linking the UID to the reservation reference                         |
| `reference_evidence_kind`       | `native_feed` or `booking_extranet`                                                               |

4. Review the complete mapping and invoke
   `adopt_sirvoy_ical_booking(actor, booking_id, source_id, evidence)` through the
   trusted operator workflow. It supports only unambiguous, single-room
   Booking.com source bookings. Changed initial dates, another unit, an already
   imported UID, or incomplete evidence stop the operation for review.
5. Verify the same booking ID, unchanged dates/source/financial/communication
   fields, and the audit row. The exact same call is idempotent. Bind all relevant
   source holds before enabling this source. Actual provider synchronization and
   outbound destination-aware export still require their own verification.

The audit is owner-readable and not public. Neither authenticated users nor the
service role can overwrite/delete its rows. Bound UID/source identity and source
URL/unit/channel identity cannot be reassigned. Normal server synchronization may
update the same booking or apply explicit `STATUS:CANCELLED`. Mere disappearance
does not cancel documentary source holds; it records missing observations for
operator review. Existing original archive rows and payment guards are retained.

## Sirvoy's own room export

Use `channel_type=sirvoy`, not `booking`, for an aggregate Sirvoy room calendar.
`adopt_sirvoy_export_booking` is a separate trusted-operator RPC with the same
paused-source, closed-sales, actor/property, one-room, immutable source and date
checks. Its evidence has the ten fields above plus `native_event_summary`:

- `provider_reference` and `sirvoy_booking_reference` must both equal the
  original Sirvoy booking reference.
- `native_event_summary` must be the observed exact `Booking <reference>` text.
- `reference_evidence_kind` is `sirvoy_native_feed`; retain the actual feed bytes
  and their SHA-256. UID text is observed, never inferred from that reference.

A source cannot be resumed while its unit has unbound future source holds.
Bind all reviewed holds in one guarded transaction and verify all unrelated
booking fields before resuming. The RPC does not fetch or authenticate the
external feed: the operator must review the actual retained evidence first.

Sirvoy `Closed` events are imported as unit-scoped `closed` rate rules through
the existing fenced sync claim. ICS `DTEND` is exclusive, so the stored rule's
inclusive `date_to` is one day earlier. No customer booking, payment or message
is created for a closure. The source/UID pair is unique; a later event updates
only that rule's dates and active status. Calendar rules cannot be edited or
deleted through the ordinary owner rule editor. Existing manual/source-imported
rules are never overwritten.

Mere disappearance of a Sirvoy booking or closure does not reopen inventory.
Missing active future closures appear as a protected count in the sync result
and as an operator-review warning in the persisted source status.
An explicit `STATUS:CANCELLED` can cancel the linked booking or disable the
calendar's own closure. A missing event requires operator review; if the provider
only removes cancelled events, that review remains part of operations. A failed
or partial import leaves freshness invalid, including failures storing closures.

Incoming synchronization is not a two-way cutover. Do not open shared direct
inventory until the outbound path to the active channel manager is independently
verified. Existing manual winter restrictions remain effective even if the
calendar's duplicate winter closure later changes or disappears.

### Reviewed release of a missing closure

The ordinary price-rule editor intentionally cannot override calendar-owned
closures. Until a dedicated review UI exists, a trusted operator must retain
fresh evidence from Sirvoy that the specific block has ended, keep direct sales
closed, and check the exact source/unit/UID and current rule row in a guarded
transaction. Use the existing `claim_ical_sync` / `write_ical_sync_block` fence
with `p_cancelled=true` for that one reviewed rule, then finish with
`p_success=false` and a sanitized review status, and leave the source paused.
This is an operator-confirmed release, not proof that an ICS cancellation was
received. Keep the evidence and before/after hashes privately. Resume only after
a fresh complete import; a still-present Closed event reactivates the rule.
Never deactivate the independent manually imported winter rules in this process.
