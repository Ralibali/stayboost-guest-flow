# StayBoost · Go-live-guide

Från noll till bokningar på riktigt. Räkna med ~30 minuter.
Allt körs i Supabase-miljön — ingen egen server behövs.

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
supabase db push        # lägger alla 9 migrationer
```

## 3. Deploya edge-funktionerna

```bash
supabase functions deploy  # deployar alla 10 funktioner
```

## 4. Hemligheter (secrets)

```bash
supabase secrets set \
  CRON_SECRET="$(openssl rand -hex 24)" \
  BREVO_API_KEY="xkeysib-..." \
  BREVO_SENDER_EMAIL="info@dindoman.se" \
  BREVO_SENDER_NAME="Din Anläggning" \
  ELKS_API_USER="u..." \
  ELKS_API_PASSWORD="..." \
  STRIPE_SECRET_KEY="sk_live_..." \
  STRIPE_WEBHOOK_SECRET="whsec_..." \
  PUBLIC_APP_URL="https://boka.dindoman.se" \
  GUEST_PAGE_BASE_URL="https://boka.dindoman.se"
```

| Hemlighet | Var hittar man den? |
|---|---|
| `BREVO_API_KEY` | [brevo.com](https://brevo.com) → SMTP & API → API Keys (gratis nivå räcker) |
| `ELKS_*` | [46elks.se](https://46elks.se) → API credentials (för SMS, kan hoppas över) |
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` | Se steg 6 nedan |

## 5. Schemaläggning (cron)

Öppna **SQL Editor** i Supabase och kör innehållet i `supabase/cron.sql`.
Det schemalägger iCal-synk var 15:e minut och meddelandeutskick var 5:e minut.

## 6. Stripe-webhooken

Stripe Dashboard → **Developers → Webhooks → Add endpoint**:

- **URL:** `https://<PROJECT-REF>.supabase.co/functions/v1/stripe-webhook`
- **Events:** `checkout.session.completed` + `checkout.session.expired`
- Kopiera **Signing secret** → sätt som `STRIPE_WEBHOOK_SECRET` (steg 4)

## 7. Frontend

Appen byggs med miljövariablerna:

```bash
VITE_SUPABASE_URL="https://<PROJECT-REF>.supabase.co" \
VITE_SUPABASE_ANON_KEY="<anon key från Settings → API>" \
npm run build
```

Deploya på valfri host (Vercel/Netlify/egna servern) eller använd
plattformens förhandsvisning. Koppla sedan din domän, t.ex. `boka.dindoman.se`.

## 8. Första anläggningen

1. Öppna appen → skapa konto → ange anläggningsuppgifter
2. **Inställningar → Din bokningssida**: kopiera iframe-snutten till hemsidan
3. **Inställningar → Enheter**: lägg till tält/stugor med priser
4. **iCal-källor**: klistra in Booking.com/Airbnbs exportlänkar
5. **Tillval**: badtunna, ved, frukost…
6. **Chatt**: slå på, fyll i mottagarmejl, klistra snippeten på hemsidan

## 9. Testa hela kedjan (5 min)

- [ ] Boka via din egen bokningssida med testkort `4242 4242 4242 4242`
- [ ] Kolla att bokningen dyker upp i admin som **Betald**
- [ ] Kolla att bekräftelsemejlet kommer fram
- [ ] Öppna gästlänken — ser allt rätt ut?
- [ ] Blockera samma datum i Booking.coms kalender → vänta 15 min →
      kolla att de blivit bokade i din kalender
- [ ] Skicka ett chattmeddelande från hemsidan → kommer det till din mejl?

**Klart — du är live.** 🎉

---

### Felsökning

| Symptom | Trolig orsak |
|---|---|
| "Bokningssidan hittades inte" | `slug` i länken matchar inte anläggningens slug |
| Betald men står som "väntar" | Webhook-secret fel, eller fel events valda i Stripe |
| Inga mejl skickas | `BREVO_*` saknas, eller avsändaren inte verifierad i Brevo |
| iCal synkar inte | Kolla **iCal-källor** → statusraden visar felet |
