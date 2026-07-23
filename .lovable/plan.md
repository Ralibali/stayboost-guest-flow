
# Go-live-audit: StayBoost → goglampingsweden.se

Bedömning av koden som den ligger nu. Inga ändringar föreslås — bara vad som är redo, vad som är risk och vad som blockerar skarp drift. Kod-referenser bekräftade i denna audit; drift-status (Supabase-projekt, secrets, cron, Stripe live, DNS) kan jag inte inspektera utan att Cloud aktiveras eller att du bekräftar. Punkter märkta **[OVERIFIERAT]** kräver din bekräftelse.

---

## Sammanfattning

Kärnan är produktionsklar: hardening-migrationen `20260722100000` ger race-säker överlappsspärr (advisory lock + trigger), kapacitetsvalidering, Swish-hold, betalgatade meddelanden, SSRF-skyddad iCal och per-anläggning Storage-policies. Stripe-webhooken verifierar HMAC. Fas 1-RLS är strikt (allt via `owner_id`, inga anon-policies). Men flera drift- och integrationsbitar måste bekräftas eller åtgärdas innan trafik läggs över från Sirvoy.

**Verdict: inte lanseringsklar idag.** ~5 riktiga blockers, resten är checklistpunkter.

---

## Blockers (måste åtgärdas före skarp drift)

1. **Booking.com tvåvägssynk saknas i praktiken.** Bara Airbnb-typad iCal (import via `ical-sync` + export via `ical-export`) är byggd. Booking.com kräver att man klistrar in exportfeeden i extranet — det fungerar, MEN Booking.com pollar bara ~var 2–4:e timme. Dubbelbokning mellan direkt+Booking.com är fullt möjlig under det fönstret. Sirvoy erbjuder oftast snabbare/API-baserad synk. **Måste dokumenteras för kunden som en känd risk, eller lösas med extra check-in-buffer/manuell block.**
2. **Cron är inte deployad automatiskt.** `supabase/cron.sql` är en manuell fil ("kör MANUELLT … efter deploy"). Utan detta körs varken `ical-sync` (var 15:e min) eller `send-scheduled-messages` (var 5:e min) → inga påminnelser, inga automatiska Swish-timeouts, inga kanaluppdateringar. **[OVERIFIERAT]** att den är körd i skarpa projektet.
3. **Stripe live-nycklar + webhook-endpoint.** Koden är klar men `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` måste vara live-nycklar och webhook-endpointen registrerad hos Stripe för events `checkout.session.completed` + `checkout.session.expired`. **[OVERIFIERAT]**.
4. **Ingen historikimport från Sirvoy.** Befintliga framtida bokningar i Sirvoy måste antingen (a) importeras via Sirvoys iCal-export in i StayBoost innan cutover, eller (b) sitta kvar i Sirvoy parallellt tills sista utcheckning. Annars säljs samma nätter dubbelt. Sirvoy-webhooken finns (`sirvoy-webhook`), men den fångar bara nya event efter att den kopplats — inte historik.
5. **`GUEST_PAGE_BASE_URL` / `PUBLIC_APP_URL` måste peka på goglampingsweden.se.** Dessa styr länkar i alla gäst-mejl och Stripe success/cancel. Fel värde = gäster landar på fel domän. Guiden noterar också att `GUEST_PAGE_BASE_URL` är global (Fas 2-punkt), inte per-anläggning — okej för en kund, blockerare för multi-tenant senare.

---

## Höga risker (fixa gärna, men inte hårda blockers)

- **Ingen e-postverifiering krävs i signup.** `app/login.tsx` kör bara `signUp` utan att kontrollera `email_confirmed_at`. Vem som helst kan skapa ett konto och sätta upp en anläggning som "sin". För en single-tenant Bergs-Slussar/Göta-Kanal-lansering: skapa ägarkontot manuellt, lås signup-vyn eller sätt Supabase "Confirm email" = på. **[OVERIFIERAT]** i Auth-inställningarna.
- **Inget HIBP-lösenordsskydd.** `configure_auth` med `password_hibp_enabled: true` rekommenderas.
- **Ingen 2FA** för operatörskontot. Lämpligt för en anläggning som hanterar riktiga bokningar och gästdata.
- **Rate limiting bara på booking-engine (IP-hash i `booking_attempts`).** Övriga publika endpoints (`guest-page`, `sirvoy-webhook`, `stripe-webhook`, `ical-export`) förlitar sig på 24-hex-token respektive HMAC — okej, men ingen brute-force-skydd finns om någon börjar bruta guest_tokens. 96 bitar entropi räcker sannolikt.
- **Inga Supabase-schemalagda backups aktiverade [OVERIFIERAT]** — kräver rätt Supabase-plan. Utan detta är recovery = "senaste manuella dump".
- **Ingen GDPR "radera gäst"-funktion.** Bokningar innehåller `guest_name/email/phone/notes`. Ägaren kan i praktiken bara `DELETE` via SQL. En "anonymisera avslutade bokningar efter X månader"-cron finns inte.
- **Personuppgiftsbiträdesavtal (DPA) finns bara som sida** (`/dpa`) — ingen signering, ingen versionering. För B2B-kund räcker "läs och skriv under manuellt", men det måste faktiskt göras.
- **Ingen övervakning/alerting.** Om `send-scheduled-messages` börjar returnera `failed > 0` upptäcks det bara om ägaren loggar in på dashboarden. Ingen mejl-notis, ingen Sentry.
- **In-memory rate limiting i `subscribe.functions.ts` / `sms.functions.ts`** nollställs vid varje Worker-omstart. Räcker för landningssidans lead magnet men skulle behöva bytas till Supabase-backad om det blir en attackvektor.
- **`booking-engine` cachar aldrig OPTIONS/GET-svar** — okej, men lasttest är inte gjort. Landing page-trafik + demo-trafik + skarp bokning på samma projekt.

---

## Genomgång per område

### Databas & migrationer
- 7 migrationer, alla read och tekniskt koherenta. Fas 1 RLS är strikt (`owner_id`), `owns_property()` security definer. Hardening lägger race-säker trigger `prevent_managed_booking_overlap` med advisory lock — löser samtidiga direkt/manuella dubbelbokningar deterministiskt.
- Kvarstår: `checkout_date > checkin_date` finns, men iCal-källor kan fortfarande importera överlapp (medvetet, av deploy-skäl) och flaggas bara i UI. Verifiera att UI-varningen faktiskt syns i `/app/bokningar` innan skarpt.

### Autentisering
- Endast e-post/lösenord, ingen social login, ingen MFA. Rimligt för en enda operatör men bekräfta att e-postbekräftelse är på i Supabase.

### Bokningsflöde & dubbelbokningsskydd
- Publik motor (`booking-engine`, `verify_jwt=false`) validerar datum, min-stay, kapacitet (`max_guests` per unit), överlapp både i preflight-select och via DB-trigger. Betald flöden skapas som `pending` + `payment_expires_at` (Stripe 30 min, Swish operatörsjusterbart 15–1440 min). Bra.
- Manuella bokningar från `/app` går via samma trigger — säkert.

### Stripe / Swish
- Stripe: HMAC-verifiering korrekt, SEK/belopp-kontroll i `_shared/stripe.ts`, expired-event avbokar `pending` bokningar. Behöver bara live-secrets + registrerad endpoint.
- Swish: manuell markering av operatören + auto-avboka via cron-jobb baserat på `payment_expires_at`. Beroende av att cronjobbet faktiskt körs (se blocker #2).

### Kanalsynk (Booking.com / Airbnb)
- Import: `ical-sync` var 15:e min för alla källor. SSRF-skydd (privata IP:er blockeras). Behöver `pg_cron` + `pg_net` + `cron_secret` i Vault.
- Export: `ical-export` per unit-token; kanalerna pollar. Booking.com's ~2–4h polling är den enda dubbelboknings-luckan i systemet.

### E-post & SMS
- Brevo (transaktionell mejl) och 46elks (SMS) via secrets. `send-scheduled-messages` väntar korrekt på `payment_status != pending` innan utskick. Läggs på bokningen både vid direkt- och iCal-import. Kräver `BREVO_SENDER_EMAIL` verifierad hos Brevo, DKIM/SPF/DMARC för avsändardomänen — annars hamnar mejl i skräppost. **[OVERIFIERAT]**.

### Domän
- Custom domain-flödet är standard Lovable (A → 185.158.133.1 + TXT `_lovable`). Behöver antingen bytas från Sirvoys hosting eller peka `boka.goglampingsweden.se` mot Lovable, medan huvudsidan ligger kvar där den ligger. **[OVERIFIERAT]** hur nuvarande DNS ser ut.

### Webhooks & secrets
- Sirvoy-webhook (token i URL), Stripe-webhook (HMAC). Båda `verify_jwt=false` i `config.toml`. Secrets som måste finnas i Supabase Edge Function-secrets: `CRON_SECRET`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `ELKS_API_USER`, `ELKS_API_PASSWORD`, `ELKS_SENDER`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `GUEST_PAGE_BASE_URL`, `PUBLIC_APP_URL`. Plus `cron_secret` i Vault. Alla **[OVERIFIERAT]**.

### Backup & export
- Supabase automatiska backups: **[OVERIFIERAT]** beroende av plan. Manuell `pg_dump` går alltid. Ingen application-level dataexport (t.ex. "ladda ner alla bokningar som CSV") — bör byggas om ägaren ska kunna migrera vidare.

### GDPR
- RLS strikt, gäster har ingen inloggning (bra — minimerad exponering). Integritetspolicy/villkor/cookies/DPA-sidorna finns och är konfigurerade med Aurora Media AB + org.nr. Saknas: rutin för radering av gästuppgifter, retentionpolicy, registerförteckning. LEK-krav på cookies är okej (Plausible cookiefritt).

### Tester
- 49 tester grönt (vitest): fas1-flöde (27), stats (17), production-hardening (5). Testar migrations-simulering (via lokal pg), inte edge functions körande i Deno. Ingen E2E mot skarpt Supabase-projekt. Rimligt för lansering, men första-timmarnas manuella rök-test enligt checklistan nedan är obligatoriskt.

---

## Exakt lanseringschecklista

Ordning spelar roll — hoppa inte över.

**Innan cutover:**
1. Bekräfta att `supabase db push` har kört alla 7 migrationer i skarpa projektet.
2. Deploya alla 7 edge functions med `config.toml`-inställningarna (`verify_jwt` per funktion).
3. Sätt samtliga secrets i Supabase Edge Function-secrets (se listan ovan).
4. Aktivera `pg_cron` + `pg_net`, lägg `cron_secret` i Vault, kör `supabase/cron.sql` (byt `<PROJEKT-REF>`). Verifiera med `select * from cron.job;` och kolla att `send-scheduled-messages` svarar 200 vid nästa 5-minuterstick.
5. Registrera Stripe-webhook: `https://<ref>.supabase.co/functions/v1/stripe-webhook`, events `checkout.session.completed` + `checkout.session.expired`. Klistra signing secret in i `STRIPE_WEBHOOK_SECRET`.
6. Testkör Stripe test mode: full bokning med `4242 4242 4242 4242` → gästsidan visar Betald + bekräftelsemejl kommer efter betalning. Avbryt en Checkout → efter Swish-hold/30 min frigörs datumen och inget mejl går ut.
7. Skapa operatörskontot i Supabase Auth manuellt (undvik öppen signup för nu). Aktivera "Confirm email" och HIBP i Auth-inställningarna.
8. Onboarda anläggningen i `/app/onboarding`: slug (`bergs-slussar` eller motsvarande), enheter med pris/min_stay/städavgift/max_guests, tillval, iCal-källor per tält (Airbnb/Booking-länkar) och klistra exportfeeden i extranet för tvåvägssynk.
9. Konfigurera Brevo-avsändardomän med DKIM/SPF/DMARC. Skicka ett testmejl till egen adress och kontrollera att det inte hamnar i skräppost.
10. Konfigurera 46elks-avsändarnamn (max 11 tecken).
11. **Sirvoy-migrering:** importera Sirvoy-kalendern som iCal-källa så framtida bokningar blockeras korrekt, ELLER låt Sirvoy sitta kvar tills sista utcheckningen är passerad. Slå INTE av Sirvoys kanaler innan detta är på plats.
12. Byt till Stripe live-nycklar. Uppdatera webhook-endpointen om en separat live-endpoint krävs.
13. Peka `boka.goglampingsweden.se` (eller huvuddomän) mot Lovable via A-record → 185.158.133.1 + TXT `_lovable`.

**Efter cutover (första 48 h):**
14. Gör en riktig bokning med eget kort. Verifiera hela kedjan: bokning → Stripe → webhook → gästsida → bekräftelsemejl → påminnelse-SMS på incheckningsdagen.
15. Verifiera att iCal-export syns i Airbnb/Booking.com inom 2–4h efter en manuell bokning skapats.
16. Kontrollera `/app` dashboard: ingen `payment_conflicts`, `messaging_failures` eller `ical_errors`.
17. Backup-rutin: bekräfta att Supabase automatisk backup är aktiverad, dokumentera manuell `pg_dump`-kommando som fallback.
18. Sätt en enkel uptime-monitor (t.ex. UptimeRobot) mot `https://<domän>/boka/<slug>` och gästsidan.

**Ska byggas nästa vecka (inte blockerande men viktigt):**
19. GDPR-radering av gästuppgifter efter N månader (cron eller manuell knapp i `/app`).
20. Sentry/Slack-notis om `send-scheduled-messages` failar mer än X gånger på en timme.
21. Bokningsexport (CSV) från `/app`.
22. Backupplan om Booking.com dubbelbokar — SLA-text på gästsidan + rutin för operatören.

---

## Vad jag inte kunde verifiera själv

Kräver Cloud-aktivering, secrets-läsning eller att du bekräftar:

- Är cron faktiskt körd i det skarpa Supabase-projektet?
- Är Stripe-webhook registrerad + live-nycklar satta?
- Är Brevo-domänen verifierad med DKIM/SPF/DMARC?
- Vad pekar `goglampingsweden.se` A-record på idag?
- Är Supabase-planen på en nivå som ger automatiska backups?
- Är e-postbekräftelse + HIBP påslaget i Auth?

Säg till om jag ska aktivera Lovable Cloud på projektet så jag kan läsa/verifiera secrets, körande cronjobb, edge-loggar och Auth-konfig direkt istället för att lita på **[OVERIFIERAT]**-punkterna.
