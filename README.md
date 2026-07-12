# StayBoost guest flow

Lanseringssida och pilotfunnel för StayBoost: gästkommunikation, tillval och enkla arbetsvyer för glamping, stugor och små boenden.

## Vad som faktiskt fungerar

- Pilotansökningar skickas till Brevo.
- Gratisguiden registrerar kontakt i en separat Brevo-lista och låser upp en utskriftsvänlig guide.
- SMS-demon skickar ett riktigt SMS via 46elks.
- Formulär har servervalidering, honeypot och hastighetsbegränsning.
- Upstash Redis kan användas för beständig hastighetsbegränsning i produktion. Utan Redis används ett minnesbaserat reservskydd.
- Live-demon visas bara om `VITE_PUBLIC_DEMO_BASE` är konfigurerad, så trasiga demolänkar publiceras inte.
- Integritetspolicy, pilotvillkor, sitemap och robots.txt finns som statiska sidor.

Produktvisningen på startsidan använder exempeldata och genomför inga riktiga köp eller bokningsändringar. Det framgår tydligt på sidan.

## Lokal utveckling

```bash
bun install
cp .env.example .env
bun run dev
```

## Obligatorisk produktionskonfiguration

Minst följande krävs för att alla formulär ska fungera:

- `ELKS_API_USER`
- `ELKS_API_PASSWORD`
- `BREVO_API_KEY`
- `BREVO_PILOT_LIST_ID`
- `BREVO_TEMPLATES_LIST_ID`
- `RATE_LIMIT_SALT`

För stabil hastighetsbegränsning över flera serverinstanser rekommenderas också:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Skapa Brevo-listorna först och använd deras numeriska list-ID:n. Koden kräver inga anpassade Brevo-attribut.

## Kontroll före publicering

```bash
bun run check
```

Kommandot kör TypeScript-kontroll, ESLint, tester och produktionsbuild.

Gör därefter ett fullständigt manuellt test:

1. Skicka pilotformuläret med en ny e-postadress och kontrollera rätt Brevo-lista.
2. Begär SMS-guiden och kontrollera både Brevo-listan och länken till guiden.
3. Skicka SMS-demon till ett svenskt testnummer.
4. Försök samma nummer igen och verifiera begränsningsmeddelandet.
5. Testa startsidan, policies och guiden på mobil.
6. Aktivera inte `VITE_PUBLIC_DEMO_BASE` förrän samtliga demorutter fungerar med exempeldata.

## Säkerhetsprinciper

- Hemligheter ska bara ligga i plattformens servermiljö, aldrig i `VITE_*`-variabler eller i GitHub.
- SMS-reservationen återställs om 46elks-anropet misslyckas, så ett tillfälligt leverantörsfel låser inte numret.
- Telefon och IP hashas innan de används i begränsningslagret.
- Skarp gästdata ska inte aktiveras innan personuppgiftsbiträdesavtal, gallring och rollbehörigheter är klara.
