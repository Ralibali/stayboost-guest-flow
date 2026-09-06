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

## Vad CORE gör idag (gästflöde efter bokning)

- Förankomst, sms, tillval och incheckning. Inte Bergs bokningsknapp.
- Tillval (upsell) i gästens eget flöde.
- Digital incheckning, frukostvy och städvy.
- Sms finns i produkten. På Bergs visade den publika statsidan antal förankomst-sms. Produktions-cron är inte bevisad.
- Bokningsmotorn syns bara som produktdemo på `/produkten/boka` — exempeldata, inget debiteras.

## Vad CORE inte gör

- Bergs live-knapp. `goglampingsweden.se/boka` är Sirvoy-iframe (0 Booking.com).
- Isolerad multi-tenant. Isolation är obevisad.
- Kanalhantering. Sirvoy är kvar. SAFE_TO_CANCEL_SIRVOY = NEJ.
- SaaS-intäkt. Ingen Stripe-checkout för abonnemanget.
- AI-operatör.
- Automatisk Sirvoy-historikimport. iCal är bara datum.

## Invändningar

Se `SALES_FAQ` i `src/lib/sales-readiness.ts` (isolering, Sirvoy, go-live, data, sms).

## Demo-CTA

Produktdemo (exempeldata): `/produkten` — bokningsmotor bara på `/produkten/boka`.  
`/demo` är 404, hitta inte på den.  
Öppen signup är inte säljvägen (isolation obevisad).  
Kontakt: `info@stayboost.se`  
Ingen Stripe-checkout för 449-abonnemanget.
