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
