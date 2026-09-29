# StayBoost · Go-live-guide

Från noll till bokningar på riktigt. Räkna med ~45 minuter.
Databas, edge-funktioner och cron körs i Supabase. Frontend (TanStack Start,
SSR) körs på Lovable/valfri Node-host och har **egna** server-hemligheter (steg 8).

---

## 1. Skapa Supabase-projektet

1. [supabase.com](https://supabase.com) → **New project**
2. Region: **Stockholm (eu-north-1)** — närmast gästerna
3. Spara databaslösenordet någonstans säkert
4. Notera **Project ref** (t.ex. `abcdefghijklmnop`)

## 2. Skjut ut databasen

```bash
npm i -g supabase
supabase login
supabase link --project-ref <DITT-PROJECT-REF>
supabase db push        # lägger alla 18 migrationer i supabase/migrations/
```

> `supabase/pending-migrations/` (audit-logg + prisregler) körs **inte** av
> `db push`. Klienten fungerar utan dem. Kör dem manuellt i SQL Editor när du
> vill aktivera prisregler-vyn (`/app/prisregler`) på riktigt — se README där.

## 3. Deploya edge-funktionerna

```bash
supabase functions deploy  # deployar alla 14 funktioner i supabase/functions/
```

`supabase/config.toml` styr vilka funktioner som kör utan JWT (publika
webhooks, gästsida, bokningsmotor, cron). Den följer med automatiskt.

## 4. Hemligheter för edge-funktionerna

```bash
supabase secrets set \
  CRON_SECRET="$(openssl rand -hex 24)" \
  BREVO_API_KEY="xkeysib-..." \
  BREVO_SENDER_EMAIL="info@dindoman.se" \
  BREVO_SENDER_NAME="Din Anläggning" \
  ELKS_API_USER="u..." \
  ELKS_API_PASSWORD="..." \
  ELKS_SENDER="StayBoost" \
  STRIPE_SECRET_KEY="sk_live_..." \
  STRIPE_WEBHOOK_SECRET="whsec_..." \
  SAAS_STRIPE_WEBHOOK_SECRET="whsec_..." \
  PUBLIC_APP_URL="https://stayboost.se" \
  GUEST_PAGE_BASE_URL="https://stayboost.se"
```

| Hemlighet                    | Var hittar man den?                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| `CRON_SECRET`                | Slumpa själv. **Samma värde** ska in i Vault i steg 5.                                        |
| `BREVO_API_KEY`              | [brevo.com](https://brevo.com) → SMTP & API → API Keys (gratis nivå räcker)                   |
| `ELKS_*`                     | [46elks.se](https://46elks.se) → API credentials (SMS; kan hoppas över, då går allt via mejl) |
| `STRIPE_SECRET_KEY`          | Stripe Dashboard → Developers → API keys                                                      |
| `STRIPE_WEBHOOK_SECRET`      | Gästernas bokningsbetalningar — steg 6                                                        |
| `SAAS_STRIPE_WEBHOOK_SECRET` | StayBoost-abonnemanget — steg 6 (valfri, status synkas även utan)                             |
| `RATE_LIMIT_SALT`            | Valfri. Faller tillbaka på service-role-nyckeln.                                              |

## 5. Schemaläggning (cron)

En enda pg_cron-job (`stayboost-ops-cron`, var 5:e minut) anropar `ops-cron`,
som i sin tur kör iCal-synk (var 15:e minut), meddelandeutskick, hälsokontroller
och larm. **Registrera inga separata jobb för ical-sync/send-scheduled-messages** —
då körs de dubbelt.

1. Supabase Dashboard → **Database → Extensions**: aktivera `pg_cron` och `pg_net`
2. **SQL Editor** — skapa Vault-hemligheterna (byt till dina värden, committa aldrig):
   ```sql
   select vault.create_secret('https://<PROJECT-REF>.supabase.co', 'project_url');
   select vault.create_secret('<samma värde som CRON_SECRET>', 'stayboost_cron_secret');
   ```
3. Kör hela innehållet i `supabase/cron/register-production-jobs.sql`
4. Verifiera efter 5–10 min:
   ```sql
   select job_name, last_started_at, last_succeeded_at, last_error
     from public.ops_job_state order by job_name;
   ```

## 6. Stripe-webhooks

Stripe Dashboard → **Developers → Webhooks → Add endpoint** (två stycken):

**A. Gästbetalningar**

- URL: `https://<PROJECT-REF>.supabase.co/functions/v1/stripe-webhook`
- Events: `checkout.session.completed`, `checkout.session.expired`
- Signing secret → `STRIPE_WEBHOOK_SECRET`

**B. StayBoost-abonnemang (SaaS)**

- URL: `https://<PROJECT-REF>.supabase.co/functions/v1/saas-stripe-webhook`
- Events: `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`
- Signing secret → `SAAS_STRIPE_WEBHOOK_SECRET`

Prisplan (449 kr/mån · 4 490 kr/år exkl. moms) och moms-rate skapas automatiskt
i Stripe första gången någon startar checkout — inget att konfigurera manuellt.

## 7. Plattformsägare

Lägg till ditt eget konto som plattformsadmin (krävs för `/app` → ägarpanelen):

```sql
insert into public.platform_admins (user_id)
select id from auth.users where email = 'info@auroramedia.se';
```

## 8. Frontend

Publika build-variabler:

```
VITE_SUPABASE_URL=https://<PROJECT-REF>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key från Settings → API>
VITE_PUBLIC_BOOKING_URL=<Cal.com-länk för "Boka 20 min med grundaren", valfri>
```

Server-hemligheter (SSR-funktionerna för nyhetsbrev/lead magnet och manuella
SMS körs i frontend-hosten, **inte** i Supabase — sätt dessa i Lovable/hostens
env, aldrig som `VITE_*`):

```
BREVO_API_KEY=xkeysib-...
BREVO_LIST_ID=<listan för early access>
BREVO_TEMPLATES_LIST_ID=<listan för SMS-mallar>
BREVO_TEMPLATE_ID_TRIAL=<Brevo-mall: välkomstmejl trial>
BREVO_TEMPLATE_ID_SMS_MALLAR=<Brevo-mall: PDF-länk>
PUBLIC_LEADMAGNET_PDF_URL=https://stayboost.se/mallar/stayboost-12-sms.pdf
ELKS_API_USER=...
ELKS_API_PASSWORD=...
ELKS_SENDER=StayBoost
```

Ladda upp lead magnet-PDF:en till `public/mallar/stayboost-12-sms.pdf` innan
mallformuläret på startsidan slås på — annars länkar mejlet till en 404.

Koppla domänen `stayboost.se` (sitemap, canonical och OG-bilder är hårdkodade
till den).

## 9. Första anläggningen

1. Öppna appen → skapa konto → ange anläggningsuppgifter
2. **Inställningar → Din bokningssida**: kopiera iframe-snutten till hemsidan
3. **Inställningar → Enheter**: lägg till tält/stugor med priser
4. **iCal-källor**: klistra in Booking.com/Airbnbs exportlänkar
5. **Tillval**: badtunna, ved, frukost…
6. **Chatt**: slå på, fyll i mottagarmejl, klistra snippeten på hemsidan

## 10. Testa hela kedjan (10 min)

- [ ] Boka via din egen bokningssida med testkort `4242 4242 4242 4242`
- [ ] Kolla att bokningen dyker upp i admin som **Betald**
- [ ] Kolla att bekräftelsemejlet kommer fram
- [ ] Öppna gästlänken — ser allt rätt ut?
- [ ] Blockera samma datum i Booking.coms kalender → vänta 15 min →
      kolla att de blivit bokade i din kalender
- [ ] Skicka ett chattmeddelande från hemsidan → kommer det till din mejl?
- [ ] Starta ett StayBoost-abonnemang från billing-vyn med testkort → status **aktiv**
- [ ] `ops_job_state` visar `last_succeeded_at` för alla jobb

**Klart — du är live.** 🎉

---

### Felsökning

| Symptom                                  | Trolig orsak                                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| "Bokningssidan hittades inte"            | `slug` i länken matchar inte anläggningens slug                                    |
| Betald men står som "väntar"             | Webhook-secret fel, eller fel events valda i Stripe                                |
| Inga mejl skickas                        | `BREVO_*` saknas, eller avsändaren inte verifierad i Brevo                         |
| iCal synkar inte                         | Kolla **iCal-källor** → statusraden visar felet                                    |
| `ops_job_state` tomt / `last_error: 401` | Vault-`stayboost_cron_secret` ≠ `CRON_SECRET`, eller register-skriptet inte kört   |
| Lead magnet/early access ger fel         | Frontend-hostens `BREVO_*` (steg 8) saknas — de är inte samma som Supabase-secrets |
