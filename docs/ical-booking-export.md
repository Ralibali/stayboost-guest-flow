# Booking.com iCal export

Use the dedicated **Kopiera iCal-länk till Booking.com** link for each physical
unit in Settings. It adds `destination=booking` to the existing private unit feed.
Do not share the token publicly. The token allows reading occupied dates only;
the feed contains no guest details, source references, access codes or prices.

The Booking.com feed omits confirmed reservations whose origin is established by
the same property's linked iCal source (`channel_type=booking`) or an immutable
Sirvoy Basic source row with `Booking source` exactly `Booking.com`. This also
covers original Sirvoy calendar holds before their provider UID is adopted.
Unknown origins, direct website bookings, manual bookings and other-channel
bookings remain blocked. Active property/unit closed-date rules are always sent.

The general link remains unchanged for existing subscribers and includes all
confirmed bookings. It must not be used as the return feed for Booking.com.
Destination links do not make unknown-origin records safe to ignore or establish
a provider UID: verify the actual imported source and exact reservation identity
before binding an existing hold. Deleting or changing a source can remove its
origin evidence; review affected reservations before doing so.

Updates retain the local event UID; cancelled bookings disappear from the next
successful feed. Checkout dates are exclusive. A database or origin-view failure
returns 503 rather than an empty calendar. Invalid destinations are rejected.
Deploy the view migration before the updated `ical-export` function. There is no
booking, payment, message or provider mutation in this change.

iCal sends occupied dates, not prices, payment status or stay rules. Before a
two-way cutover, verify both real per-unit feeds, the receiver's refresh behavior,
how it represents imported blocks, and existing-booking UID adoption. This change
prevents returning known Booking.com reservations; it is not evidence of a live
two-way connection or of cancellation being processed by the other system.
