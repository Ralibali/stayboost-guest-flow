# Google Analytics 4

Current provider: Google Analytics 4. This replaces the previous Plausible integration.

- Measurement ID: `G-7VM7W21VH9`.
- Production hosts: stayboost.se, www.stayboost.se.
- Consent storage key: `stayboost_ga4_consent_v1`.
- No GA4 library or events before analytics consent. Refused events are not buffered or replayed.
- SPA pageviews are sent exactly once by `ga4Runtime.ts`. Enhanced measurement is disabled in the GA4 web stream.
- Existing business-event helpers keep their public names for compatibility; the transport converts event names to lower_snake_case (for example `Form Submitted` → `form_submitted`).
- Private routes, query strings, fragments, personal identifiers and unsafe event properties are filtered. Download tracking sends the file extension only.
- Google Signals and advertising personalization are disabled for GA4. Existing Ads conversion code, where present, has its own marketing consent.
- A persistent Cookieinställningar button allows visitors to change or withdraw their choice.
- Old Plausible setup documents are historical; do not reinstall that tracker or re-enable automatic GA4 pageviews on top of this transport.

Reference: [Google SPA measurement](https://developers.google.com/analytics/devguides/collection/ga4/single-page-applications), [Google cookie reference](https://support.google.com/analytics/answer/11397207).

Validation: production build plus existing event-helper tests and common runtime tests where a browser test environment is available. The common runtime tests cover consent, single SPA pageviews, URL/parameter redaction, withdrawal and callback fallback. Live delivery is verified separately after publication.
