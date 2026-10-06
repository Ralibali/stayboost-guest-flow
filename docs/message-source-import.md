# Imported message templates

Sirvoy message archives can be mapped into the existing `message_templates` table. Import is a service-only operation and creates **disabled drafts**. It does not send messages, create bookings or enable communication on existing bookings.

`import_sirvoy_message_template(p_property, p_actor, p_archive, p_send_time, p_schedule_archive)` reads the original JSON bytes from an immutable, same-property `sirvoy_export_archives` settings archive. It imports the five exact `subject_exact` / `source_body_html_exact` pairs and records their archive identity. Repeating the same source returns the existing template; another archive for the same source ID is a conflict. Owner UI edits remain separate from the unchanged original archive.

For relative check-in/out templates, the same-property schedule archive must contain `source_pages.localization.automatic_messages_clock` and `timezone`. The supplied time must match that clock exactly; the similarly named display-format example is not used. Hidden day/direction fields are not scheduling authority. Unknown event kinds remain disabled manual drafts. Non-default categories and enabled source footers are preserved but cannot be activated without additional mapping support.

Five language fields do not imply five correct translations. Imported text is never automatically translated or corrected. In particular, placeholder-looking subjects and trailing spaces remain exact.

## Review and delivery boundaries

The owner editor uses revision-checked saves and safe previews with synthetic data. Saving a manual template never enables automation. Source identity, source metadata, review and cutover fields cannot be assigned or cleared by the browser. Editing an imported template invalidates its review and disables it again.

A separate reviewed cutover is required before imported automation can be enabled: `source_reviewed_at` and `activation_starts_at` must be present, with cutover at or after review, and source mapping must be supported. This release supplies no review/activation API and imports no production records. The operator must also resolve real-world promises in the content (for example QR/access-code instructions), choose which existing default templates the new drafts replace, and verify provider configuration before proposing activation.

Queue construction, claim and dispatch all apply this gate. Source templates never target Sirvoy-imported bookings and never backfill bookings created before cutover. Existing immutable source-calendar communication/payment guards remain unchanged. Confirmations are not backfilled by template edits or ordinary later booking updates. Retargeting a pending template to a confirmation or another confirmation channel clears the old pending rows. The existing delivery journal still prevents duplicate or uncertain retries, including during a date-driven queue replacement.

Scheduling uses calendar dates and local `Europe/Stockholm` time, including DST. `send_at` is a due time; actual dispatch waits for cron and the provider. An immediate confirmation does not use the relative-message clock.

## Rendering

The same renderer drives owner previews and dispatch. Existing plain-text templates retain the legacy Swedish date and URL behavior. Translated or HTML messages select the booking's frozen `quote_snapshot.language` (sv/en/de/da/no), use localized dates/labels and retain language in the guest-page URL. An imported template with a missing selected translation fails closed.

HTML is parsed with pinned parse5, then serialized from a small allowlist of tags, attributes, styles and URL schemes. No HTML is executed and no remote resources are loaded. Placeholders only expand in text nodes; attribute placeholders, unknown Sirvoy tokens and unsupported active HTML are rejected. Email providers receive both safe HTML and explicit text, including link destinations. SMS remains plain text.

`%bookinginfo%` renders a bounded table of recorded booking reference, accommodation, stay dates/times, guest count, frozen quoted total and purchased extras, plus a guest-page link. It is not a reproduction of Sirvoy's layout, a new public booking-number lookup or a QR/access-code service. It does not infer payments, balances, prices from today's catalog or source-history amounts. Only curated quote fields reach the delivery projection; internal notes are excluded.

## Verification and release

Tests cover the actual migrations, service-only import, archive/property scope, source and NULL-cutover guards, immutable origins, CAS conflicts, five-language rendering, HTML attacks, provider payloads, DST, no historical backfill, trigger/channel changes and existing competing-worker/uncertain-delivery behavior. Real source files may be checked privately against the parser and import RPC, but must not enter repository fixtures.

Deploy the migration, then the affected function graph from the exact reviewed commit. `send-scheduled-messages` requires its `deno.json` import map (`parse5` pinned to `npm:parse5@8.0.1`). The other runtime entrypoint sharing the changed provider helper is `booking-import`. Preserve their existing JWT settings. Neither deployment nor secret presence is proof of actual email/SMS delivery. Provider testing is a separate explicitly authorized send to the owner's chosen test recipient.
