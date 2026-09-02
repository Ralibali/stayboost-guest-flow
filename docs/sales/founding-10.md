# Founding 10 — tidiga kunder

Kanonisk sida: `https://stayboost.se/tidiga-kunder`  
Den här filen är källtexten. UI:t läser samma fakta från `src/lib/sales-readiness.ts`.

stayboost.se publiceras från Lovable-projektet _stayboost-sverige_. Den här branchen syns inte live förrän den är mergad och publicerad. Sitemap lämnas orörd (live-200-listan) tills sidan faktiskt svarar på stayboost.se.

## Lås

| Flagga                                 | Värde                                             |
| -------------------------------------- | ------------------------------------------------- |
| SAFE_TO_CANCEL_SIRVOY                  | **NEJ**                                           |
| Tenant-isolering redo                  | **NEJ**                                           |
| Stripe live för StayBoost-abonnemanget | **NEJ** — hitta inte på checkout                  |
| Kommersiellt live / cutover            | **NEJ**                                           |
| Pris                                   | **449 kr/mån** — samma som startsidan, ändra inte |
| PR 9                                   | rör inte, merga inte                              |

## Vad CORE gör idag

- Gäst-sms och gästhubb — en länk i mobilen, ingen app.
- Tillval som gästen betalar i sitt eget flöde (Stripe eller Swish hos anläggningen).
- Digital incheckning, frukostvy och städvy.
- Egen bokningsmotor plus iCal mot Booking.com och Airbnb. Booking.com läser ofta bara var 2–4:e timme.
- Sirvoy-parallelläge: webhook för nya bokningar och iCal så samma nätter inte säljs två gånger.
- Skarp drift på Bergs Slussar Glamping — en anläggning, inte en färdig plattform för många.

## Vad CORE inte gör

- Isolerad multi-tenant. Vi påstår inte att flera kunders data är avskild som i en färdig SaaS.
- Ersätta Sirvoy som channel manager mot Booking.com och Airbnb.
- Importera Sirvoy-historik automatiskt.
- Självbetjäning med Stripe live för StayBoost-abonnemanget.
- Klart att slå av Sirvoy.

## Invändningar

Se `SALES_FAQ` i `src/lib/sales-readiness.ts` (isolering, Sirvoy, go-live, data, sms).

## Demo-CTA

Befintlig signup: `/app/login?mode=up`  
Kontakt: `info@stayboost.se`  
Ingen Stripe-checkout för 449-abonnemanget.
