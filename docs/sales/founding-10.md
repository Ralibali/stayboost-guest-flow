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

## Vad CORE gör idag (pilot på en anläggning)

- Bokningsmotor, gästhubb, digital incheckning, frukost- och städvy.
- Gäst-sms och e-post.
- Tillval som gästen betalar i sitt eget flöde.
- PMS-vyer för den anläggningen.
- Skarp drift på Bergs Slussar Glamping — en anläggning.

## Vad CORE inte gör

- Isolerad multi-tenant. Isolation är obevisad.
- Kanalhantering. Sirvoy är kvar. SAFE_TO_CANCEL_SIRVOY = NEJ.
- SaaS-intäkt. Ingen Stripe-checkout för abonnemanget.
- AI-operatör.
- Automatisk Sirvoy-historikimport.

## Invändningar

Se `SALES_FAQ` i `src/lib/sales-readiness.ts` (isolering, Sirvoy, go-live, data, sms).

## Demo-CTA

Produktdemo (exempeldata): `/produkten` — `/demo` är 404, hitta inte på den.  
Befintlig signup: `/app/login?mode=up`  
Kontakt: `info@stayboost.se`  
Ingen Stripe-checkout för 449-abonnemanget.
