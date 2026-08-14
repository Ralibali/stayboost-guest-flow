# Guest Experience 2027

Den här rundan gör StayBoost redo för en mer självgående premiumdrift på Bergs Slussar Glamping.

## Nytt

- Tillval kan prissättas per bokning, natt, person eller person och dygn.
- Tillval kan ha daglig kapacitet, exempelvis sex cyklar totalt.
- Gäster kan köpa tillval i efterhand från sin personliga gästsida via Stripe.
- Pågående Stripe-checkout reserverar tillvalskapacitet i 30 minuter.
- Gästens accesskod hålls dold tills strax före incheckning.
- Dagsöversikten samlar ankomster, avresor/städ och tillval som behöver förberedas.
- Tillval kan märkas för ankomstdag, varje vistelsedag eller varje morgon efter övernattning.

## Rekommenderad Bergs-konfiguration

### Canal Picnic Ride
- Pris: 895 kr
- Prismodell: per person & dygn
- Max per dag: antal cyklar som finns i drift
- Förberedelse: varje vistelsedag
- Driftinstruktion: cykel + hjälm + packväska + matsäck i Bike Station/Guest Pantry

### Frukost
- Pris: ordinarie frukostpris per person
- Prismodell: per person & dygn
- Förberedelse: varje morgon efter övernattning
- Driftinstruktion: märkt påse i Guest Pantry före avtalad tid

## Deploy

1. Kör de två migrationerna från 2026-08-15.
2. Deploya `guest-addon-checkout`, uppdaterad `guest-page`, `booking-engine` och `stripe-webhook`.
3. Kontrollera att `PUBLIC_APP_URL`, Stripe live-secrets och webhooken är satta.
4. Lägg in/uppdatera tillvalen i `/app/tillval`.
5. Provboka och provköp ett tillval från `/g/<token>` innan skarp trafik.

Booking.com/iCal-risken från tidigare go-live-audit påverkas inte av den här rundan och måste fortfarande hanteras innan full cutover från Sirvoy.
