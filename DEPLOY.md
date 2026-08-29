# StayBoost · Go-live-guide

HQ-checklista för **en** anläggning. StayBoost är **inte kommersiellt live**
förrän varje obligatorisk ruta nedan är ikryssad i den skarpa miljön.
Preview-hosten `*.lovable.app` är **inte** produktion. `stayboost.se` är den
kanoniska värden. DNS kan redan peka (A → `185.158.133.1`) — det är **inte**
cutover. Den här filen deployar ingenting och sätter inga Stripe-live-nycklar.

Hoppa inte över steg. Ett hoppat steg = inte live-klar.

---

## 0. Fail-closed (läs först)

| Får inte gå live utan | Varför |
|---|---|
| Cron **körts** i Supabase SQL Editor | Utan cron: inga iCal-uppdateringar, inga gästpåminnelser, inga Swish-timeouts |
| `PUBLIC_APP_URL` + `GUEST_PAGE_BASE_URL` = `https://stayboost.se` | Gästmejl och Stripe success/cancel får annars preview-länkar |
| Stripe **live**-nycklar + webhook | Testnycklar tar inte riktiga betalningar |
| Sirvoy-historik importerad **eller** Sirvoy kvar tills sista utcheckning | Annars säljs samma nätter två gånger |
| Ägarkonto skapat + Confirm email på | Öppen signup är single-tenant-risk |

Den här guiden **påstår inte** att cron, Stripe, DNS eller Sirvoy-import är gjorda.

---

## 1. Supabase-projekt

1. [supabase.com](https://supabase.com) → **New project** (eller använd det skarpa)
2. Region: **Stockholm (eu-north-1)**
3. Spara databaslösenordet offline
4. Notera **Project ref**

## 2. Databas

```bash
npm i -g supabase
supabase login
supabase link --project-ref <DITT-PROJECT-REF>
supabase db push
```

- [ ] Alla migrationer i `supabase/migrations/` är applicerade
- [ ] `select * from cron.job;` är **tom** här — cron kommer i steg 5, inte via `db push`

## 3. Edge-funktioner

```bash
supabase functions deploy
```

- [ ] Alla funktioner i `supabase/functions/` är deployade med `config.toml` (`verify_jwt` per funktion)

## 4. Hemligheter (inga värden i git)

Sätt secrets i **Supabase Dashboard / CLI**. Klistra aldrig in live-nycklar i PR eller repo.

```bash
supabase secrets set \
  CRON_SECRET="$(openssl rand -hex 24)" \
  BREVO_API_KEY="xkeysib-..." \
  BREVO_SENDER_EMAIL="info@stayboost.se" \
  BREVO_SENDER_NAME="StayBoost" \
  ELKS_API_USER="u..." \
  ELKS_API_PASSWORD="..." \
  STRIPE_SECRET_KEY="sk_live_..." \
  STRIPE_WEBHOOK_SECRET="whsec_..." \
  PUBLIC_APP_URL="https://stayboost.se" \
  GUEST_PAGE_BASE_URL="https://stayboost.se"
```

| Hemlighet | Default / regel |
|---|---|
| `PUBLIC_APP_URL` | **Dokumenterad default: `https://stayboost.se`**. Aldrig `*.lovable.app`. Styr Stripe success/cancel. |
| `GUEST_PAGE_BASE_URL` | **Samma default.** Styr gästlänkar i mejl/SMS. |
| `STRIPE_SECRET_KEY` | Måste vara `sk_live_…` före cutover. **OWNER GATE.** |
| `CRON_SECRET` | Samma värde ska ligga i Vault som `cron_secret` (steg 5). |

Frontend (Lovable / Vite):

```bash
VITE_SUPABASE_URL="https://<PROJECT-REF>.supabase.co"
VITE_SUPABASE_ANON_KEY="<anon key>"
VITE_ALLOW_PUBLIC_SIGNUP="false"
# VITE_PUBLIC_BOOKING_URL=   # sätt bara när en riktig Cal.com/Savvycal-länk finns
```

- [ ] `PUBLIC_APP_URL` och `GUEST_PAGE_BASE_URL` är `https://stayboost.se` (eller den skarpa custom-domänen när DNS är klart — aldrig preview-hosten)
- [ ] Inga secrets committade

## 5. Cron — OBLIGATORISKT (inte valfritt)

`supabase/cron.sql` ingår **inte** i migrationerna. Utan detta steg är produkten inte live-klar.

Gå **inte** vidare förrän alla rutor är ikryssade. Att skippa cron är ett go-live-stopp.

1. Supabase Dashboard → **Database → Extensions**
   - [ ] `pg_cron` aktiverad
   - [ ] `pg_net` aktiverad
2. **Project Settings → Vault**
   - [ ] Hemlighet `cron_secret` skapad, **samma värde** som edge-funktionernas `CRON_SECRET`
3. **SQL Editor**: öppna `supabase/cron.sql`, byt `<PROJEKT-REF>` mot project ref, kör hela filen
   - [ ] Körningen lyckades utan fel
4. Verifiera (fail-closed — tomt resultat = **stopp**):

```sql
select jobname, schedule, active
from cron.job
where jobname in ('stayboost-ical-sync', 'stayboost-dispatch');
```

- [ ] Båda jobben finns och `active = true`
- [ ] `stayboost-ical-sync` är `*/15 * * * *`
- [ ] `stayboost-dispatch` är `*/5 * * * *`

5. Vänta till nästa 5-minuterstick och kontrollera edge-loggar för `send-scheduled-messages`
   - [ ] Ett anrop med 200 (inte 401 — då matchar inte `cron_secret` / `CRON_SECRET`)

**Den här checklistan deployar inte cron.** Den dokumenterar att du måste köra den manuellt och bevisa att jobben finns.

## 6. Stripe-webhook — OWNER GATE

Stripe Dashboard → **Developers → Webhooks → Add endpoint**:

- **URL:** `https://<PROJECT-REF>.supabase.co/functions/v1/stripe-webhook`
- **Events:** `checkout.session.completed` + `checkout.session.expired`
- Signing secret → `STRIPE_WEBHOOK_SECRET`

- [ ] Testläge: bokning med `4242 4242 4242 4242` → Betald + bekräftelsemejl
- [ ] Avbruten Checkout / utgången session frigör datumen
- [ ] **Live-nycklar utbytta före cutover** (inte gjort av den här PR:n)

## 7. Single-tenant-konto (lås inte ute ägaren)

Signup i `/app/login` är **av** om inte `VITE_ALLOW_PUBLIC_SIGNUP=true`. Inloggning fungerar alltid.

1. Skapa ägarkontot **innan** du stänger signup:
   - antingen tillfälligt `VITE_ALLOW_PUBLIC_SIGNUP=true`, skapa kontot, sedan tillbaka till `false`
   - eller skapa användaren i Supabase Auth-dashboarden
2. Supabase Auth:
   - [ ] **Confirm email = på**
   - [ ] HIBP-lösenordsskydd på (rekommenderat)
3. - [ ] Ägaren kan logga in
4. - [ ] `VITE_ALLOW_PUBLIC_SIGNUP=false` i produktion (slumpkonton ska inte kunna skapa anläggningar)

## 8. Anläggning + kanaler

1. Onboarda i `/app/onboarding`
2. **Inställningar**: boenden, priser, tillval
3. **Kalenderkopplingar**: Sirvoy/Airbnb/Booking.com **import**-feeds
4. Klistra **export**-länken i extranätet
5. Läs den orange varningen: Booking.com pollar iCal **~2–4 h**. Det är inte tvåvägs API-synk.

- [ ] Booking.com-fördröjningen är känd av operatören
- [ ] **Sirvoy-historik:** importera framtida bokningar som iCal **eller** låt Sirvoy sitta kvar tills sista utcheckning. **OWNER GATE.** Slå inte av Sirvoys kanaler innan detta.

## 9. Domän — OWNER GATE

- [x] `stayboost.se` DNS-live (A → Lovable `185.158.133.1`, HTTPS 200). **Inte** kommersiell go-live.
- [ ] Preview `*.lovable.app` används inte i mejl, gästlänkar, Stripe eller legal canonicals
- [ ] Lovable **Hide Lovable badge** på i Project settings → Publishing (Pro). Koden gömmer `#lovable-badge` som reserv.

Koden defaultar till `https://stayboost.se`. Republish krävs för att first-byte på den skarpa domänen ska sluta läcka preview-URL:er. Den här PR:n köper ingen domän.

## 10. Röktest före cutover

- [ ] Boka via `/boka/<slug>` med testkort
- [ ] Admin visar **Betald**
- [ ] Bekräftelsemejl kommer och gästlänken pekar på `stayboost.se` (eller den skarpa custom-domänen)
- [ ] Gästsidan `/g/<token>` fungerar
- [ ] Booking.com-kalenderblock syns efter nästa iCal-sync (import ~15 min; **export** syns hos Booking.com först efter deras 2–4 h-poll)
- [ ] Dashboard: inga `payment_conflicts`, `messaging_failures` eller `ical_errors`

**Inte live** förrän steg 5 (cron verifierad), 6 (Stripe live), 8 (Sirvoy-historik) och 9 (DNS) är klara.

---

### Felsökning

| Symptom | Trolig orsak |
|---|---|
| "Bokningssidan hittades inte" | `slug` matchar inte |
| Betald men står som "väntar" | Webhook-secret fel, eller fel Stripe-events |
| Inga mejl | `BREVO_*` saknas eller avsändare overifierad |
| iCal synkar inte | **Kalenderkopplingar** → statusraden; eller cron inte körd (steg 5) |
| Gästlänk går till lovable.app | `PUBLIC_APP_URL` / `GUEST_PAGE_BASE_URL` fel — sätt `https://stayboost.se` |
| Kan inte skapa konto | Förväntat i produktion. Logga in, eller tillfällig `VITE_ALLOW_PUBLIC_SIGNUP=true` |
