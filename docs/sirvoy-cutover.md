# Övertagande från Sirvoy

StayBoost har direktbokning, gästportal, betalning, prisregler, daglig drift,
Sirvoy-import och en Channex-adapter. En installerad adapter innebär inte att
någon extern bokningskanal har flyttats. Varje kanal behöver en verifierad
anslutning och verkliga provflöden innan Sirvoy stängs.

## Förbered anläggningen

1. Lägg in alla fysiska tält, deras faktiska kapacitet och kontaktuppgifter.
2. Aktivera priser efter antal vuxna när sådana priser används. Barnens ålder vid
   incheckning styr tillägget; även barn som bor gratis räknas i tältets kapacitet.
   Ange säsongspriser och stängda perioder i **Pris & regler**. En ofullständig
   vuxentabell stoppar bokningen i stället för att välja ett billigare reservpris.
3. Spara boendets egen HTTPS-länk till bokningsvillkor i **Inställningar**.
4. Konfigurera Stripe och dess betalnings-/återbetalningswebhooks, eller manuell
   Swish-kontroll. Verifiera bekräftelsemejl och eventuella SMS med provgäster.
5. Frukost som kostar per portion och morgon ska ha pris **Per natt** och
   leveransplan **Varje morgon**. Antalet gäller portioner per morgon. Leveranser
   skapas från dagen efter ankomst till och med avresedagen. Alla leveransdagar
   måste ligga inom tillvalets säsong. Äldre köp ändras inte när katalogen ändras.

## Flytta bokningarna

1. Ta en aktuell Sirvoy-export av **Booking content** och **Basic info**, med
   rätt datumintervall och bokningsstatus. Spara originalen för avstämning.
2. Öppna **Flytta från Sirvoy**. Läs in filerna och koppla varje Room ID till
   rätt tält. Kontrollera datum och status. Uttryckliga avbokningar utelämnas;
   okända statusar stoppar importen. Saknar exporten status krävs avstämning i
   Sirvoy så att avbokningar inte återupplivas.
3. Kontrollera gästantalet per tält. Sirvoys Guests kan avse vuxna medan barn
   finns bland Extras. StayBoost ska få summan av vuxna, barn och småbarn.
4. Importera efter granskning. Alla vistelser i samma import sparas tillsammans
   eller avbryts tillsammans vid en konflikt. Samma Sirvoy-bokning och Room ID
   importeras inte två gånger. En ny import skriver inte över redan flyttad data.
5. Importen bevarar boendebeloppet per tält i hela SEK och originalets tillval
   som interna anteckningar. En betalningsrad eller hela bokningens totalsumma
   kopieras inte till varje tält. Barnpriser, tillval och deras leveranser måste
   stämmas av mot originalet; importen skapar inga påhittade leveransköp.
6. Öppna varje importerad bokning och registrera styrkt betalning före flytten
   med datum, belopp och underlag. Det är en dokumentation av tidigare betalning,
   ingen ny debitering. Återbetalning i det tidigare systemet kan dokumenteras
   separat. Ursprungliga underlag och ändringshistorik ligger kvar.
7. Gästmeddelanden är pausade vid importen. Efter avstämning kan ägaren aktivera
   kommande meddelanden per bokning. Gamla bekräftelser och förfallna utskick
   återskapas inte. Kontrollera att Sirvoy inte skickar samma kommande meddelanden.

## Flytta kanalerna

Följ [Channex-guiden](channex-setup.md). Booking.com och Airbnb behöver
partneranslutning och rätt rum/rate plan-mappning. BookVisit behöver bekräftad
support för kontot. Google behöver en godkänd Hotel Centre-/bokningsmotorlösning;
en normal Channex-anslutning ger inte automatiskt rätt att använda StayBoosts
egen bokningssida för Google Hotel Ads.

Certifiera i staging innan produktionsanslutningen öppnas. Testa ny bokning,
ändring, avbokning, flera tält, gamla och dubblerade händelser, API-avbrott och
återhämtning. Kontrollera vuxenpriser, barn-/småbarnsgränser, avgifter, minst antal
nätter och stängda datum på själva kanalen. Kanaldata med okänd mappning eller
konflikt blockerar nya direktbokningar tills incidenten har lösts. Aktiverade
kanaler måste ha en fullständig bokningssynk inom fem minuter och en fullständig
kalendersynk inom 26 timmar; annars pausas nya lokala bokningar och flyttar.

Gör en sista bokningsavstämning under bytet. Samma kanal ska ha en ansvarig
källa för tillgänglighet och priser. Stäng inte Sirvoy förrän varje avsedd kanal
läser rätt data från den nya anslutningen och en verklig bokning syns korrekt i
StayBoost. Byt därefter hemsidans bokningsknapp och kontrollera både mobil och
dator, gästlänk, betalning, meddelande och leveransuppgifter.

## Fel efter öppning

Pausa direktbokning och berörda kanaler vid osäker tillgänglighet. Läs den
konkreta incidenten i **Bokningskanaler**. Åtgärda mappning/konflikt och kör en
full synk innan försäljningen återupptas. Återbetalningsfel ska ligga kvar som en
åtgärd tills pengarna faktiskt har återbetalats. En pågående kanalsynk använder
ett fem minuter långt lås. När kanaldata blir för gammal kvarstår bokningsspärren
tills synken har återhämtat sig; gästen får ett tydligt meddelande att försöka igen.

Ett osäkert svar från mejl- eller SMS-leverantören markeras för granskning och
skickas inte automatiskt igen. Kontrollera leverantörens leveranslogg först.
