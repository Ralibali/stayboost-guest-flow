import { createFileRoute } from "@tanstack/react-router";
import { LegalLayout } from "@/components/legal/LegalLayout";

const CANONICAL = "https://stayboost-sverige.lovable.app/integritetspolicy";

export const Route = createFileRoute("/integritetspolicy")({
  component: PrivacyPolicy,
  head: () => ({
    meta: [
      { title: "Integritetspolicy — StayBoost" },
      {
        name: "description",
        content:
          "Så behandlar StayBoost (Aurora Media AB) personuppgifter enligt GDPR — vilka uppgifter vi samlar in, varför, rättslig grund, lagringstid och dina rättigheter.",
      },
      { property: "og:title", content: "Integritetspolicy — StayBoost" },
      {
        property: "og:description",
        content: "Så behandlar StayBoost personuppgifter enligt GDPR.",
      },
      { property: "og:url", content: CANONICAL },
      { property: "og:type", content: "article" },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
});

function PrivacyPolicy() {
  return (
    <LegalLayout title="Integritetspolicy" updated="12 juli 2026">
      <p>
        Denna integritetspolicy beskriver hur <strong>Aurora Media AB</strong> (”StayBoost”, ”vi”)
        behandlar personuppgifter i tjänsten StayBoost och på webbplatsen{" "}
        <code>stayboost.se</code>. Vi följer EU:s dataskyddsförordning (GDPR), lagen om elektronisk
        kommunikation (LEK) samt svensk marknadsföringslag.
      </p>

      <h2>1. Personuppgiftsansvarig</h2>
      <p>
        Aurora Media AB, org.nr [org.nr fylls i], Linköping, Sverige.
        <br />
        Kontakt: <a href="mailto:privacy@stayboost.se">privacy@stayboost.se</a>
      </p>

      <h2>2. Vilka uppgifter vi behandlar</h2>
      <ul>
        <li>
          <strong>Kontaktuppgifter</strong> (namn, e-post, telefon, företag) — när du fyller i
          formulär, bokar demo eller startar en provperiod.
        </li>
        <li>
          <strong>Kunduppgifter</strong> (fakturaadress, betalinformation via vår betalpartner) —
          för dig som är kund.
        </li>
        <li>
          <strong>Användningsdata</strong> (inloggningar, klick, händelser i tjänsten) — för drift,
          säkerhet och produktförbättring.
        </li>
        <li>
          <strong>Innehåll du lägger in</strong> (gästlistor, meddelandemallar, bilder) — som ett
          led i att leverera tjänsten till dig som kund.
        </li>
        <li>
          <strong>Teknisk data</strong> (IP-adress, webbläsare, tidsstämpel) — för säkerhet,
          bedrägeriskydd och rate limiting.
        </li>
      </ul>

      <h2>3. Ändamål och rättslig grund</h2>
      <ul>
        <li>
          <strong>Leverera och utveckla tjänsten</strong> — fullgörande av avtal (art. 6.1 b GDPR).
        </li>
        <li>
          <strong>Support och kundkommunikation</strong> — avtal och berättigat intresse (art. 6.1
          b & f).
        </li>
        <li>
          <strong>Marknadsföring till befintliga kunder</strong> — berättigat intresse (art. 6.1 f),
          med möjlighet att avregistrera i varje utskick.
        </li>
        <li>
          <strong>Nyhetsbrev, gratismallar, tips-mail</strong> — samtycke (art. 6.1 a). Du kan
          återkalla samtycket när som helst.
        </li>
        <li>
          <strong>Bokföring och skatt</strong> — rättslig förpliktelse (art. 6.1 c, 7 år enligt
          bokföringslagen).
        </li>
        <li>
          <strong>Säkerhet, bedrägeriskydd, missbrukshantering</strong> — berättigat intresse (art.
          6.1 f).
        </li>
      </ul>

      <h2>4. Lagringstid</h2>
      <ul>
        <li>Nyhetsbrev/prospekt: tills du avregistrerar dig eller är inaktiv i 24 månader.</li>
        <li>Kunduppgifter: under avtalstiden och därefter så länge det finns en rättslig grund.</li>
        <li>Bokföringsunderlag: 7 år (bokföringslagen).</li>
        <li>Loggar / säkerhetsdata: som regel högst 12 månader.</li>
        <li>
          Demo-SMS-formulär: telefonnummer sparas endast för rate-limit-kontroll i 24 timmar.
        </li>
      </ul>

      <h2>5. Mottagare och personuppgiftsbiträden</h2>
      <p>
        Vi delar uppgifter med underleverantörer som behandlar personuppgifter enligt vår
        instruktion (personuppgiftsbiträden):
      </p>
      <ul>
        <li>
          <strong>Lovable Cloud / Supabase</strong> — databas, autentisering, filhantering (EU).
        </li>
        <li>
          <strong>Cloudflare</strong> — hosting, edge-nätverk och DDoS-skydd.
        </li>
        <li>
          <strong>Brevo (Sendinblue)</strong> — e-postutskick, nyhetsbrev, transaktionsmail (EU).
        </li>
        <li>
          <strong>46elks</strong> — SMS-utskick (Sverige/EU).
        </li>
        <li>
          <strong>Plausible Analytics</strong> — cookiefri, aggregerad besöksstatistik (EU).
        </li>
      </ul>
      <p>
        Fullständig lista och biträdesavtal (DPA) finns på{" "}
        <a href="/dpa">/dpa</a>. Vid överföring till tredje land används EU-kommissionens
        standardavtalsklausuler (SCC).
      </p>

      <h2>6. Dina rättigheter</h2>
      <ul>
        <li>Rätt till registerutdrag (art. 15).</li>
        <li>Rätt till rättelse (art. 16) och radering (art. 17, ”rätten att bli glömd”).</li>
        <li>Rätt till begränsning och invändning (art. 18 & 21).</li>
        <li>Rätt till dataportabilitet (art. 20).</li>
        <li>Rätt att återkalla samtycke.</li>
      </ul>
      <p>
        Kontakta oss på <a href="mailto:privacy@stayboost.se">privacy@stayboost.se</a>. Är du inte
        nöjd har du rätt att klaga till{" "}
        <a href="https://www.imy.se" rel="noopener" target="_blank">
          Integritetsskyddsmyndigheten (IMY)
        </a>
        .
      </p>

      <h2>7. Säkerhet</h2>
      <p>
        Vi använder kryptering i transit (TLS) och i vila, minsta möjliga behörighet, loggning och
        regelbunden granskning. Personuppgiftsincidenter anmäls till IMY inom 72 timmar när kravet
        i art. 33 GDPR är uppfyllt.
      </p>

      <h2>8. Automatiserat beslutsfattande</h2>
      <p>Vi fattar inga beslut om dig som enbart baseras på automatiserad behandling.</p>

      <h2>9. Ändringar</h2>
      <p>
        Vi kan uppdatera denna policy. Vid väsentliga ändringar meddelar vi via e-post eller
        tydligt meddelande i tjänsten.
      </p>
    </LegalLayout>
  );
}
