import { CANONICAL_ORIGIN } from "@/lib/site-url";

/** StayBoost CORE sales-readiness. PREPARE only — not a go-live flip. */
export const MONTHLY_PRICE_SEK = 449;
export const PRICE_LABEL = "449 kr/mån";

/** Sirvoy stays up. Do not cancel channels or the PMS. */
export const SAFE_TO_CANCEL_SIRVOY = false;

/** Multi-tenant isolation is not a product claim. */
export const TENANT_ISOLATION_READY = false;

/** No invented Stripe live checkout for the StayBoost subscription. */
export const STRIPE_SAAS_CHECKOUT_LIVE = false;

/** DNS-live on stayboost.se is not commercial cutover. */
export const COMMERCIALLY_LIVE = false;

export const CONTACT_EMAIL = "info@stayboost.se";
export const SALES_PATH = "/tidiga-kunder";
export const SIGNUP_PATH = "/app/login";
export const SIGNUP_SEARCH = { mode: "up" as const };

export const SALES_CANONICAL = `${CANONICAL_ORIGIN}${SALES_PATH}`;

export const CORE_DOES = [
  "Gäst-sms och gästhubb — en länk i mobilen, ingen app.",
  "Tillval som gästen betalar i sitt eget flöde (Stripe eller Swish hos anläggningen).",
  "Digital incheckning, frukostvy och städvy.",
  "Egen bokningsmotor plus iCal mot Booking.com och Airbnb. Booking.com läser ofta bara var 2–4:e timme.",
  "Sirvoy-parallelläge: webhook för nya bokningar och iCal så samma nätter inte säljs två gånger.",
  "Skarp drift på Bergs Slussar Glamping — en anläggning, inte en färdig plattform för många.",
] as const;

export const CORE_DOES_NOT = [
  "Isolerad multi-tenant. Vi påstår inte att flera kunders data är avskild som i en färdig SaaS.",
  "Ersätta Sirvoy som channel manager mot Booking.com och Airbnb.",
  "Importera Sirvoy-historik automatiskt. Framtida nätter måste in via iCal — eller sitta kvar i Sirvoy.",
  "Självbetjäning med Stripe live för StayBoost-abonnemanget. Ingen kortbetalning för 449 kr här.",
  "Klart att slå av Sirvoy. SAFE_TO_CANCEL_SIRVOY = NEJ.",
] as const;

export const SALES_FAQ: ReadonlyArray<{ q: string; a: string }> = [
  {
    q: "Är min anläggning isolerad från andras?",
    a: "Nej, inte som produktpåstående. CORE körs i skarp drift på en anläggning. I koden finns ägarfält (owner_id), men det är inte samma sak som färdig tenant-isolering. Vi säljer inte isolation.",
  },
  {
    q: "Kan vi säga upp Sirvoy när vi börjar?",
    a: "Nej. Sirvoy är kvar tills sista utcheckningen. StayBoost tar emot nya Sirvoy-event och kan läsa iCal för att blockera nätter. Historiken kommer inte in av sig själv. Slå inte av Sirvoys kanaler.",
  },
  {
    q: "Är StayBoost live — kan vi gå över på en kväll?",
    a: "stayboost.se svarar. Det är inte samma sak som kommersiell cutover. Det finns ingen Stripe-checkout för abonnemanget. Första kunderna kör parallellt med det de redan har. Ingen cutover-plan utan att Sirvoy sitter kvar.",
  },
  {
    q: "Vem har gästdatan?",
    a: "Aurora Media AB i Linköping. Du äger bokningar och gästuppgifter. Integritetspolicy och personuppgiftsbiträdesavtal ligger på stayboost.se. Det finns ingen knapp för att radera en gäst i appen än — det görs manuellt.",
  },
  {
    q: "Vad kostar sms:en?",
    a: "Sms ingår i StayBoost-abonnemanget och debiteras inte separat. Det finns ingen sms-pott, inga credits och ingen extra kostnad per skickat sms. Priset är 449 kr/mån.",
  },
];
