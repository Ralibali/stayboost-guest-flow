import { createFileRoute } from "@tanstack/react-router";
import { LegalLayout } from "@/components/legal/LegalLayout";
import { legalPageUrl } from "@/lib/site-url";

const CANONICAL = legalPageUrl("/cookies");

export const Route = createFileRoute("/cookies")({
  component: Cookies,
  head: () => ({
    meta: [
      { title: "Cookies — StayBoost" },
      {
        name: "description",
        content:
          "Så fungerar StayBoosts nödvändiga lagring och valfria statistikcookies för Google Analytics 4.",
      },
      { property: "og:title", content: "Cookies — StayBoost" },
      { property: "og:url", content: CANONICAL },
      { property: "og:type", content: "article" },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
});

function Cookies() {
  return (
    <LegalLayout title="Cookies och lokal lagring" updated="20 september 2026">
      <p>
        Enligt lagen (2003:389) om elektronisk kommunikation (LEK) och EU:s ePrivacy-direktiv får vi
        endast lagra information i din webbläsare med ditt samtycke — undantaget cookies som är
        strikt nödvändiga för att leverera tjänsten.
      </p>

      <h2>Vad vi använder</h2>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[color:var(--line)] text-left">
            <th className="py-2 pr-4">Namn</th>
            <th className="py-2 pr-4">Syfte</th>
            <th className="py-2 pr-4">Typ</th>
            <th className="py-2">Livstid</th>
          </tr>
        </thead>
        <tbody className="align-top">
          <tr className="border-b border-[color:var(--line)]/60">
            <td className="py-2 pr-4">sb-auth-token</td>
            <td className="py-2 pr-4">Inloggad session i tjänsten</td>
            <td className="py-2 pr-4">Nödvändig</td>
            <td className="py-2">Session</td>
          </tr>
          <tr className="border-b border-[color:var(--line)]/60">
            <td className="py-2 pr-4">stayboost-stats-cache</td>
            <td className="py-2 pr-4">
              Mellanlagrar publik statistik lokalt så att sidan inte visar nollor vid nätfel
            </td>
            <td className="py-2 pr-4">Nödvändig</td>
            <td className="py-2">7 dagar</td>
          </tr>
          <tr>
            <td className="py-2 pr-4">_ga, _ga_*</td>
            <td className="py-2 pr-4">Besöksstatistik via Google Analytics 4</td>
            <td className="py-2 pr-4">Valfri statistik</td>
            <td className="py-2">Upp till 2 år</td>
          </tr>
        </tbody>
      </table>

      <h2>Ditt val styr statistiken</h2>
      <p>
        Google Analytics 4 laddas först när du accepterar statistik. Google använder cookies för att
        skilja besök åt och mäta sidvisningar och valda händelser. Vi skickar inte formulärinnehåll,
        kunduppgifter eller privata gästlänkar till GA4. Du kan neka och återkalla ditt samtycke via
        knappen Cookieinställningar. Valet sparas lokalt i stayboost_ga4_consent_v1 tills du ändrar
        det eller rensar din webbläsare.
      </p>

      <h2>Hantera i webbläsaren</h2>
      <p>
        Du kan alltid rensa cookies och lokal lagring via webbläsarens inställningar. Om du rensar{" "}
        <code>sb-auth-token</code> loggas du ut ur tjänsten.
      </p>

      <h2>Frågor</h2>
      <p>
        Kontakta <a href="mailto:info@auroramedia.se">info@auroramedia.se</a>.
      </p>
    </LegalLayout>
  );
}
