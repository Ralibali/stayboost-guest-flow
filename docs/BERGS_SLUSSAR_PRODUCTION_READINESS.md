# Bergs Slussar → StayBoost Production Readiness

## Syfte

Bergs Slussar Glamping ska vara StayBoosts första riktiga lighthouse-anläggning och produktionsreferens. Målet är inte att bygga en demo utan att låta verkliga bokningar, gäster, tillval och daglig drift bevisa produkten innan bred försäljning.

Bokningsmotorn ska finnas kvar som en viktig del av StayBoost, men full channel-manager-cutover ska inte ske innan synk/reconciliation är tillräckligt säker.

## Produktprincip

StayBoost ska kunna användas på två nivåer:

1. **Operations + Revenue ovanpå befintligt bokningssystem/channel manager**.
2. **StayBoost Booking** för direktbokningar via den egna webbplatsen.

Bergs Slussar får köra parallellt med Sirvoy/Booking.com tills StayBoosts channel-sync är verifierad i verklig drift.

---

## Nuvarande repo-sanning

### Redan verklig produktionsgrund

- `/app/idag` läser riktiga bokningar från Supabase och visar ankomster, avresor, gäster på plats och betalnings-/kontaktproblem.
- `/app/bokningar` är operatörens bokningsadmin.
- `/app/kalender` finns.
- `/app/kallor` hanterar iCal-källor och hälsostatus.
- `/app/tillval` finns.
- direktbokningsroute `/boka/$slug` finns.
- personlig gästsida `/g/$token` finns.
- Stripe, Swish, meddelanden, iCal och Sirvoy-grund finns i backend.

### Kritisk skillnad: Frukost och Städ

De snygga vyerna för frukost och städ finns i dag som:

- `/demo/frukost`
- `/demo/stad`

De använder `demo-data` och lokal React-state. De är alltså produktdesign/prototyper, inte produktionssanning.

Eftersom Bergs Slussar använder frukost- och städvyer mycket ska de behandlas som **P0 operativa ytor**, inte som demo-funktioner.

---

# P0 – Bergs Slussars kärnflöden

## 1. `/frukost` – förstaklassig produktionsvy

### Målet

En enkel mobilvy som kan öppnas på morgonen och som alltid svarar på:

> Vad ska göras, till vem, när och är något avvikande?

### Data ska komma från verkliga bokningar

För vald servicedag ska vyn härleda betalda/bekräftade frukostbeställningar från:

- `bookings`
- `booking_addons`
- `addons`
- enhet
- gästantal
- eventuella efterköp av tillval

PR #5 innehåller redan rätt grundmodell för `service_timing = each_morning`. Den ska selektivt portas till current main i stället för att uppfinnas igen.

### Vyn ska minst visa

- datum
- totalt antal portioner
- antal bokningar med frukost
- enhet/tält
- gästens namn när behörigheten tillåter
- antal portioner
- leverans-/serveringstid
- allergi/specialkost
- anteckning
- status: `Att förbereda` → `Pågår` → `Klar/levererad`
- tydlig varning för specialkost
- tydlig varning för sena ändringar
- uppdatering/realtime eller säker refresh

### Status måste persisteras

Nuvarande demo-status lever bara i React-state. Produktionsvyn ska skriva status/timestamps till databasen så att:

- flera telefoner ser samma status
- en refresh inte återställer arbetet
- ägaren kan se vad som är klart
- historik kan användas vid felsökning

### Bergs-konfiguration

Frukost ska kunna konfigureras som:

- prismodell: per person / person & dygn enligt affärsregeln
- service timing: `each_morning`
- beställningsstopp: konfigurerbar tid, initialt t.ex. 20:00 kvällen före
- fulfillment note/instruktion för personal
- möjlighet till sen order endast med tydlig varning/regler

### Route

Behåll en enkel route som är lätt att använda operativt:

- `/frukost` som teamvänlig shortcut, eller
- säker redirect till `/app/frukost`

Exakt auth-lösning får implementeras säkert, men personalen ska inte behöva navigera genom hela admin för att komma till frukostlistan.

---

## 2. `/stad` – förstaklassig produktionsvy

### Målet

Städpersonalen ska kunna öppna en mobilvy och direkt se dagens vändningar utan att behöva läsa bokningsadmin.

### Städjobb ska härledas från verkliga bokningar

Grundregel:

- checkout idag → avresestädning
- checkin samma dag → hög prioritet / deadline före check-in
- manuellt extra städ/storstäd ska kunna läggas till separat senare

### Vyn ska minst visa

- enhet
- typ av jobb
- utcheckning
- nästa incheckning
- deadline/fönster
- uppskattad tid
- instruktion/anteckning
- checklista per enhet
- status `Väntar` → `Pågår` → `Klar`
- starttid
- klartid
- problemrapport

### Problemrapport

`Rapportera problem` ska vara verklig funktion, inte lokal demo-state.

Minimikrav:

- problemtext
- enhet
- tid
- vem/roll som rapporterade om tillgängligt
- status
- synligt för ägaren i `/app/idag`

Senare kan foto läggas till om det har tydlig nytta.

### Ready-for-check-in

När städ är klart ska StayBoost kunna markera enheten operativt redo. Detta får INTE automatiskt skicka accessinformation innan regler och säkerhet är verifierade, men statusen ska kunna användas för:

- ägarens översikt
- tidig incheckning
- automatiska meddelanden i framtiden

### Route

Behåll en enkel operativ shortcut:

- `/stad`, eller
- säker redirect till `/app/stad`

Målet är snabb åtkomst för städpersonal, inte full adminåtkomst.

---

# P0 – Guest Experience / tillval

PR #5 är **reference only** och får inte mergas wholesale eftersom branchen divergerat från nyare V2/V3.

Följande ska selektivt portas från PR #5 till en färsk branch från `main`:

1. prismodeller `per_person` och `per_person_per_night`
2. `capacity_per_day`
3. `fulfillment_note`
4. `service_timing`
   - `arrival`
   - `each_stay_day`
   - `each_morning`
5. service-day-baserad kapacitetskontroll
6. efterköp via personlig gästsida
7. race-säker pending reservation vid Stripe checkout
8. tidsstyrd accesskod om den fortfarande behövs efter aktuell produktgranskning
9. dagens verkliga service tasks som grund för frukost/drift

Varje slice ska portas mot current main, testas och QA:as separat.

---

# P0 – Channel sync safety

StayBoost får inte bli master-channel-manager för Bergs Slussar innan detta är bevisat.

## Connector-prioritet

1. officiellt API/webhook där stabilt och tillgängligt
2. befintlig channel manager/Sirvoy
3. iCal
4. strukturerad e-post/import där relevant
5. browser automation som fallback/verification
6. människa endast vid exception

Browser automation ska inte vara den enda sanningskällan för availability.

## Canonical ledger

StayBoost behöver en tydlig intern reservation representation med:

- source
- source reservation id
- property/unit
- checkin/checkout
- status
- imported/updated timestamp
- sync version/hash
- conflict state

## Reconciliation

Regelbunden kontroll:

`StayBoost availability == external channel state?`

Vid osäkerhet ska systemet hellre blockera försäljning och skapa exception än riskera dubbelbokning.

## Definition of Done för full channel cutover

- flera veckors verklig parallellkörning utan oförklarade avvikelser
- inbound reservations verifierade
- cancellations verifierade
- date changes verifierade
- outbound blocking verifierat
- retries/idempotency verifierade
- stale sync upptäcks
- conflict alert fungerar
- manual override/audit finns
- rollback till Sirvoy är dokumenterad

---

# P0 – StayBoost Booking på Bergs Slussar

Direktbokningsmotorn ska vara en riktig del av StayBoost och testas på Bergs Slussars egen trafik.

## Måste fungera

- mobil först
- rätt enhetskapacitet
- availability från samma canonical kalender
- samma-day checkout/next check-in korrekt
- prisregler
- min stay
- closed/no-arrival/no-departure
- gästantal
- tillval
- villkor/integritet
- Stripe
- Swish om fortsatt relevant
- övergiven checkout får inte låsa kalender permanent
- confirmation
- guest page
- scheduled messages
- conversion events

## Primärt försäljningsargument

Kunden behöver inte välja bort sin nuvarande bokningsmotor första dagen. StayBoost Booking är en integrerad uppgraderingsväg för direktbokningar när kunden vill.

---

# Bergs Slussar som lighthouse customer

Bergs Slussar ska ge StayBoost verkliga data för:

- bokningar
- direct booking conversion
- Booking/Sirvoy sync
- frukostorder
- tillvalsintäkt
- städjobb
- meddelanden
- problem/avvikelser
- tid sparad
- ADR / RevPAR där data är komplett
- direct booking share
- revenue per stay

## Case-study metrics

Före/efter ska vi kunna mäta:

- minuter administration per bokning
- antal manuella gästmeddelanden
- antal sync exceptions
- dubbelbokningar (mål 0)
- tillvalsintäkt per vistelse
- frukost attach rate
- direct booking conversion
- direct booking share
- tid från checkout till ready-for-check-in
- antal owner exceptions per vecka

---

# Grok execution order efter usage reset

Grok ska INTE göra en ny generell produkt-audit.

### Objective 1 – Production Truth

Verifiera current main, faktisk deployment, Supabase-migrationer/funktioner och vilka delar som är live för Bergs Slussar.

### Objective 2 – Productionize `/frukost` + `/stad`

Dessa är P0 eftersom de används i verklig drift. Utgå från demo-UX men byt till verklig data, persistent status och säker team access.

### Objective 3 – Selective Guest Experience port

Porta endast saknade delar från PR #5 mot current main.

### Objective 4 – One Perfect Bergs Stay

Följ en verklig vistelse end-to-end:

reservation → kalender → betalning/status → pre-arrival → guest page → frukost/tillval → dagens drift → städ → checkout → review/post-stay → revenue attribution.

### Objective 5 – Channel reconciliation

Bygg/validera säkrare parallell sync innan StayBoost tar över mer channel responsibility.

### Objective 6 – Sell

När Bergs-flödet är verifierat ska Growth & Sales använda det som verklig demo/case mot små boenden.

---

# Owner gates

Ägarbeslut krävs endast för:

- avstängning av Sirvoy som master/channel safety layer
- stora pris-/affärsmodelländringar
- ny betydande extern kostnad
- refunds/charges utanför beslutad policy
- destruktiv databasförändring/dataförlust
- domäntransfer/ägande
- legal/GDPR-beslut som kräver mänsklig bedömning

Normal produktutveckling, test, preview, bugfix, säker migration, observability och reversible deploy ska ske autonomt.

---

# Kort målbild

För Bergs Slussar ska en bra dag till slut se ut så här:

1. StayBoost vet vilka som bor där och vilka som kommer/åker.
2. `/frukost` visar exakt morgondagens/ dagens frukost utan manuell sammanställning.
3. `/stad` visar exakt vad som ska städas och vad som är klart.
4. Gäster får rätt information automatiskt.
5. Tillval säljs och hamnar automatiskt på rätt servicedag.
6. Booking/Sirvoy/StayBoost avvikelser upptäcks innan de blir dubbelbokningar.
7. Ägaren öppnar systemet främst när StayBoost säger att något kräver beslut.

Det är den produkt Bergs Slussar ska bevisa innan bred skalning.