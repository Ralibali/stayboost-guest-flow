import { createFileRoute } from "@tanstack/react-router";
import { LegalLayout } from "@/components/legal/LegalLayout";

const CANONICAL = "https://stayboost-sverige.lovable.app/dpa";

export const Route = createFileRoute("/dpa")({
  component: DPA,
  head: () => ({
    meta: [
      { title: "Personuppgiftsbiträdesavtal (DPA) — StayBoost" },
      {
        name: "description",
        content:
          "Personuppgiftsbiträdesavtal enligt art. 28 GDPR mellan StayBoost och kund — instruktioner, säkerhet, underbiträden och tredjelandsöverföring.",
      },
      { property: "og:title", content: "Personuppgiftsbiträdesavtal — StayBoost" },
      { property: "og:url", content: CANONICAL },
      { property: "og:type", content: "article" },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
});

function DPA() {
  return (
    <LegalLayout title="Personuppgiftsbiträdesavtal (DPA)" updated="12 juli 2026">
      <p>
        Detta biträdesavtal (”DPA”) ingås mellan kunden (”Personuppgiftsansvarig”) och{" "}
        <strong>Aurora Media AB</strong> (”Personuppgiftsbiträde”) och gäller när StayBoost
        behandlar personuppgifter för kundens räkning enligt art. 28 GDPR. Avtalet utgör en del av
        <a href="/villkor"> användarvillkoren</a>.
      </p>

      <h2>1. Föremål och varaktighet</h2>
      <p>
        StayBoost behandlar personuppgifter i syfte att leverera tjänsten under abonnemangets tid
        och i 30 dagar därefter för export eller radering.
      </p>

      <h2>2. Kategorier av registrerade och uppgifter</h2>
      <ul>
        <li>
          <strong>Registrerade:</strong> gäster hos kunden, kundens personal, kontaktpersoner.
        </li>
        <li>
          <strong>Uppgifter:</strong> namn, e-post, telefonnummer, bokningsdata, meddelanden,
          tillvalsköp, incheckningstider. Vi behandlar normalt inga känsliga personuppgifter (art.
          9); kunden ska undvika att lägga in sådana.
        </li>
      </ul>

      <h2>3. Instruktioner</h2>
      <p>
        StayBoost behandlar uppgifter enbart enligt dokumenterade instruktioner från kunden.
        Villkoren, konfiguration i tjänsten och skriftliga tilläggsinstruktioner utgör
        instruktioner. Vid krav enligt EU-rätt eller svensk lag informerar vi kunden innan
        behandling, såvida inte lag förbjuder det.
      </p>

      <h2>4. Sekretess</h2>
      <p>
        Personal med tillgång till personuppgifter är bundna av sekretess eller lagstadgad
        tystnadsplikt.
      </p>

      <h2>5. Säkerhetsåtgärder (art. 32)</h2>
      <ul>
        <li>TLS-kryptering i transit; kryptering i vila för databaser.</li>
        <li>Rollbaserad åtkomst, MFA för administratörer.</li>
        <li>Loggning, övervakning och regelbunden granskning.</li>
        <li>Kontinuerlig backup och testad återställning.</li>
        <li>Incidenthantering och rutin för anmälan enligt art. 33 GDPR inom 72 timmar.</li>
      </ul>

      <h2>6. Underbiträden</h2>
      <p>Kunden godkänner följande underbiträden:</p>
      <ul>
        <li>
          <strong>Supabase (via Lovable Cloud)</strong> — databas, autentisering, storage. EU
          (Frankfurt / Irland).
        </li>
        <li>
          <strong>Cloudflare, Inc.</strong> — hosting, edge-nätverk. EU + globalt CDN (SCC).
        </li>
        <li>
          <strong>Brevo (Sendinblue SAS)</strong> — e-postutskick. Frankrike/EU.
        </li>
        <li>
          <strong>46elks AB</strong> — sms-utskick. Sverige.
        </li>
        <li>
          <strong>Plausible Insights OÜ</strong> — cookiefri besöksstatistik. Estland/EU.
        </li>
      </ul>
      <p>
        Vi meddelar minst 30 dagar innan nya eller utbytta underbiträden tas i drift. Kunden kan
        invända och, om invändningen inte kan lösas, säga upp avtalet.
      </p>

      <h2>7. Överföring till tredje land</h2>
      <p>
        Personuppgifter behandlas som huvudregel inom EU/EES. Sker överföring till tredje land
        används EU-kommissionens standardavtalsklausuler (SCC 2021/914) samt vid behov
        kompletterande skyddsåtgärder.
      </p>

      <h2>8. Bistånd till kunden</h2>
      <p>
        Vi bistår kunden med lämpliga tekniska och organisatoriska åtgärder för att uppfylla
        skyldigheter gentemot registrerade (art. 12–22), säkerhet (art. 32), incidenthantering (art.
        33–34) samt konsekvensbedömningar (art. 35–36).
      </p>

      <h2>9. Radering och återlämnande</h2>
      <p>
        Efter avtalets upphörande raderas eller återlämnas personuppgifter enligt kundens val,
        senast 30 dagar efter avtalets slut, om inte EU-rätt eller svensk lag kräver fortsatt
        lagring.
      </p>

      <h2>10. Revision</h2>
      <p>
        Kunden har rätt till revision högst en gång per 12 månader. Vi kan uppfylla kravet genom
        aktuell tredjepartsrapport (t.ex. underleverantörers ISO 27001/SOC 2). Extra revisioner
        bekostas av kunden.
      </p>

      <h2>11. Ansvar</h2>
      <p>Ansvarsbegränsningen i användarvillkoren gäller även för denna DPA.</p>

      <h2>12. Ändringar</h2>
      <p>
        Vid ändringar i tillämplig dataskyddslag har parterna rätt att begära omförhandling av detta
        DPA.
      </p>

      <h2>13. Kontakt</h2>
      <p>
        Dataskyddsfrågor: <a href="mailto:info@auroramedia.se">info@auroramedia.se</a>
      </p>
    </LegalLayout>
  );
}
