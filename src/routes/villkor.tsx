import { createFileRoute } from "@tanstack/react-router";
import { LegalLayout } from "@/components/legal/LegalLayout";

const CANONICAL = "https://stayboost-sverige.lovable.app/villkor";

export const Route = createFileRoute("/villkor")({
  component: Terms,
  head: () => ({
    meta: [
      { title: "Användarvillkor — StayBoost" },
      {
        name: "description",
        content:
          "Villkoren för att använda StayBoost — abonnemang, provperiod, uppsägning, ansvar, immateriella rättigheter och tvistlösning enligt svensk rätt.",
      },
      { property: "og:title", content: "Användarvillkor — StayBoost" },
      { property: "og:url", content: CANONICAL },
      { property: "og:type", content: "article" },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
});

function Terms() {
  return (
    <LegalLayout title="Användarvillkor" updated="12 juli 2026">
      <p>
        Dessa villkor gäller när <strong>Aurora Media AB</strong> (”StayBoost”) tillhandahåller
        tjänsten StayBoost till dig som kund. Genom att skapa konto, starta provperiod eller använda
        tjänsten godkänner du villkoren.
      </p>

      <h2>1. Tjänsten</h2>
      <p>
        StayBoost är en molntjänst för små boendeanläggningar: gästkommunikation via sms och e-post,
        tillvalsförsäljning, incheckning, samt vyer för frukost och städning. Tjänsten levereras ”i
        befintligt skick” med rimlig upptid; planerat underhåll aviseras i förväg.
      </p>

      <h2>2. Konto och behörighet</h2>
      <p>
        Du ansvarar för att uppgifter är korrekta, att inloggningar hålls hemliga och att endast
        behöriga personer ges åtkomst. Du får inte kringgå säkerhetsfunktioner, reverse-engineera
        tjänsten eller använda den för olagligt eller vilseledande innehåll.
      </p>

      <h2>3. Provperiod</h2>
      <p>
        Ny kund får 14 dagars kostnadsfri provperiod. Provperioden övergår inte automatiskt till
        betalt abonnemang — du väljer aktivt att fortsätta.
      </p>

      <h2>4. Pris och betalning</h2>
      <ul>
        <li>Priser anges exklusive moms i SEK och löper månadsvis om inget annat avtalats.</li>
        <li>Betalning sker i förskott via kort eller faktura (14 dagars netto).</li>
        <li>
          Sms ingår upp till en generös månadsgräns; överskjutande sms debiteras till självkostnad
          utan påslag.
        </li>
        <li>
          Vid utebliven betalning har vi rätt att pausa tjänsten efter påminnelse. Dröjsmålsränta
          enligt räntelagen (referensränta + 8 %).
        </li>
      </ul>

      <h2>5. Uppsägning</h2>
      <p>
        Du kan säga upp abonnemanget när som helst med verkan från nästa faktureringsperiod. Redan
        erlagd avgift återbetalas inte. Vi kan säga upp avtalet med 30 dagars varsel eller
        omedelbart vid väsentligt avtalsbrott.
      </p>

      <h2>6. Ångerrätt (konsument)</h2>
      <p>
        För konsumenter gäller 14 dagars ångerrätt enligt lag (2005:59) om distansavtal. Om du
        börjat använda tjänsten under ångerfristen godkänner du att ångerrätten upphör i den mån
        tjänsten fullgjorts. StayBoost riktar sig primärt till näringsidkare.
      </p>

      <h2>7. Data och äganderätt</h2>
      <p>
        Du äger dina kunduppgifter och det innehåll du lägger in. Vi behandlar dessa som
        personuppgiftsbiträde enligt vårt <a href="/dpa">personuppgiftsbiträdesavtal (DPA)</a>. Vid
        avtalets slut kan du exportera din data i 30 dagar, därefter raderas den enligt vår
        gallringspolicy.
      </p>

      <h2>8. Immateriella rättigheter</h2>
      <p>
        StayBoost och all tillhörande programvara, design och dokumentation ägs av Aurora Media AB.
        Du får en icke-exklusiv, icke-överlåtbar nyttjanderätt under avtalstiden.
      </p>

      <h2>9. Ansvarsbegränsning</h2>
      <p>
        StayBoost ansvarar inte för indirekt skada, utebliven vinst eller förlorad data. Vårt
        sammanlagda ansvar under 12 månader är begränsat till vad du betalat till oss samma period.
        Ansvarsbegränsningen gäller inte vid uppsåt eller grov vårdslöshet.
      </p>

      <h2>10. Force majeure</h2>
      <p>
        Vi ansvarar inte för fel eller dröjsmål orsakade av omständigheter utanför vår rimliga
        kontroll (t.ex. avbrott hos underleverantör, cyberangrepp, myndighetsbeslut, krig).
      </p>

      <h2>11. Ändringar</h2>
      <p>
        Vi kan ändra villkoren; väsentliga ändringar aviseras minst 30 dagar i förväg via e-post
        eller i tjänsten. Om du inte accepterar ändringen har du rätt att säga upp avtalet till
        ändringens ikraftträdande.
      </p>

      <h2>12. Tillämplig lag och tvist</h2>
      <p>
        Svensk rätt tillämpas. Tvist avgörs i första hand vid Linköpings tingsrätt. Konsumenter kan
        även vända sig till{" "}
        <a href="https://www.arn.se" rel="noopener" target="_blank">
          Allmänna reklamationsnämnden (ARN)
        </a>{" "}
        eller EU:s{" "}
        <a href="https://ec.europa.eu/consumers/odr" rel="noopener" target="_blank">
          ODR-plattform
        </a>
        .
      </p>

      <h2>13. Kontakt</h2>
      <p>
        Aurora Media AB, Linköping · <a href="mailto:info@auroramedia.se">info@auroramedia.se</a>
      </p>
    </LegalLayout>
  );
}
