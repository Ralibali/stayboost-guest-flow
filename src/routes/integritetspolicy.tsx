import { createFileRoute } from "@tanstack/react-router";
import { LegalLayout } from "@/components/legal/LegalLayout";
import { legalPageUrl } from "@/lib/site-url";

const CANONICAL = legalPageUrl("/integritetspolicy");

export const Route = createFileRoute("/integritetspolicy")({
  component: PrivacyPolicy,
  head: () => ({
    meta: [
      { title: "Integritetspolicy — StayBoost" },
      {
        name: "description",
        content:
          "Så behandlar StayBoost (Aurora Media AB) personuppgifter enligt GDPR — vilka uppgifter vi samlar in, syftet, rättslig grund, lagringstid och dina rättigheter.",
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
    <LegalLayout title="Integritetspolicy" updated="1 oktober 2026">
      <p>
        Denna integritetspolicy beskriver hur <strong>Aurora Media AB</strong> (”StayBoost”, ”vi”)
        behandlar personuppgifter i tjänsten StayBoost och på webbplatsen <code>stayboost.se</code>.
        Behandlingen omfattas av EU:s dataskyddsförordning (GDPR), lagen om elektronisk
        kommunikation (LEK) och svensk marknadsföringslag.
      </p>

      <h2>1. Personuppgiftsansvarig</h2>
      <p>
        Aurora Media AB, org.nr 559272-0220, Linköping, Sverige.
        <br />
        Kontakt: <a href="mailto:info@auroramedia.se">info@auroramedia.se</a>
      </p>

      <p>
        När en boendeanläggning använder tjänsten för sina gäster är anläggningen normalt
        personuppgiftsansvarig för gästuppgifterna och StayBoost behandlar dem enligt kundens
        dokumenterade instruktioner. Begäranden om sådana uppgifter kan därför behöva skickas till
        boendeanläggningen.
      </p>

      <h2>2. Vilka uppgifter vi behandlar</h2>
      <ul>
        <li>
          <strong>Kontaktuppgifter</strong> (namn, e-post, telefon, företag) — när du fyller i
          formulär eller skapar konto.
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
          <strong>Leverera den beställda tjänsten</strong> — fullgörande av avtal (art. 6.1 b GDPR).
        </li>
        <li>
          <strong>Support och kundkommunikation</strong> — avtal och berättigat intresse (art. 6.1 b
          & f).
        </li>
        <li>
          <strong>Marknadsföring till befintliga kunder</strong> — berättigat intresse (art. 6.1 f),
          med möjlighet att avregistrera i varje utskick.
        </li>
        <li>
          <strong>Frivilliga nyhetsbrev och tipsmejl</strong> — samtycke (art. 6.1 a), som kan
          återkallas. Leverans av en särskilt beställd mall eller SMS-demo behandlas separat för att
          besvara din begäran.
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
        <li>
          Kontaktförfrågningar och prospekt: så länge uppgifterna behövs för att hantera förfrågan
          och en eventuell kundrelation. Marknadsföring stoppas vid avregistrering; uppgifter som
          behövs för att respektera spärren kan behöva behållas.
        </li>
        <li>Kunduppgifter: under avtalstiden och därefter så länge det finns en rättslig grund.</li>
        <li>Bokföringsunderlag: 7 år (bokföringslagen).</li>
        <li>
          Loggar och säkerhetsdata: så länge det behövs för felsökning och missbruksskydd, med
          begränsad åtkomst. Leverantörernas loggar och säkerhetskopior kan ha egna lagringstider;
          kontakta oss för information om den aktuella behandlingen.
        </li>
        <li>
          SMS-demo: telefonnumret skickas till 46elks för den demo du beställer. För missbruksskydd
          hålls IP-adress och ett hashvärde av numret i serverns arbetsminne. Begränsningsfönstret
          är 24 timmar och utgångna värden rensas vid nästa kontroll eller den återkommande
          minutkontrollen medan servern körs. Leverantörens leveransloggar omfattas av dess egna
          villkor.
        </li>
      </ul>

      <h2>5. Mottagare och personuppgiftsbiträden</h2>
      <p>
        Vi delar uppgifter med underleverantörer som behandlar personuppgifter enligt vår
        instruktion (personuppgiftsbiträden):
      </p>
      <ul>
        <li>
          <strong>Supabase</strong> — databas, autentisering och filhantering. Den anslutna
          databasens projektregion är Frankfurt. Det innebär inte att all support-, logg- och
          leverantörsbehandling sker inom samma region.
        </li>
        <li>
          <strong>Cloudflare</strong> — hosting, edge-nätverk och DDoS-skydd.
        </li>
        <li>
          <strong>Resend eller Brevo (Sendinblue)</strong> — leverans av e-post, enligt den
          leverantör som används i det aktuella flödet.
        </li>
        <li>
          <strong>46elks</strong> — leverans av SMS, inklusive den demo du uttryckligen beställer.
        </li>
        <li>
          <strong>Google Analytics 4 (Google)</strong> — besöksstatistik med cookies efter ditt
          samtycke. Du kan återkalla valet via Cookieinställningar. Läs mer på{" "}
          <a href="https://policies.google.com/privacy">Googles integritetspolicy</a>.
        </li>
        <li>
          <strong>Stripe</strong> — betalningstjänster när du väljer ett betalt erbjudande.
        </li>
        <li>
          <strong>Lovable AI och dess modellleverantör</strong> — bearbetning av instruktioner och
          innehåll när en AI-funktion används. Lägg inte in känsliga personuppgifter eller
          gästdetaljer som funktionen inte behöver.
        </li>
      </ul>
      <p>
        Avtalsunderlag för behandling åt kunder finns på <a href="/dpa">/dpa</a>. Externa tjänster
        kan medföra behandling utanför EU/EES. Varje sådan överföring kräver ett giltigt stöd och en
        bedömning av skyddet; kontakta oss för aktuella mottagare, avtal och överföringsskydd. Denna
        sida är inte ett intyg om att ett visst leverantörsavtal har ingåtts.
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
        Kontakta oss på <a href="mailto:info@auroramedia.se">info@auroramedia.se</a>. Vi prövar din
        begäran enligt de regler som gäller för respektive rättighet och svarar normalt inom en
        månad. Är du inte nöjd har du rätt att klaga till{" "}
        <a href="https://www.imy.se" rel="noopener" target="_blank">
          Integritetsskyddsmyndigheten (IMY)
        </a>
        .
      </p>

      <h2>7. Säkerhet</h2>
      <p>
        Webbplatsen använder HTTPS (TLS), och tillgång till konto- och kunduppgifter ska begränsas
        efter arbetsuppgift. Personuppgiftsincidenter anmäls till IMY inom 72 timmar när kravet i
        art. 33 GDPR är uppfyllt.
      </p>

      <h2>8. Automatiserat beslutsfattande</h2>
      <p>Vi fattar inga beslut om dig som enbart baseras på automatiserad behandling.</p>

      <h2>9. Ändringar</h2>
      <p>
        Vi kan uppdatera denna policy. Vid väsentliga ändringar meddelar vi via e-post eller tydligt
        meddelande i tjänsten.
      </p>
    </LegalLayout>
  );
}
