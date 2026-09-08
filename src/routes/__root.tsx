import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { initAnalytics } from "../lib/analytics";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl">404</h1>
        <h2 className="mt-4 text-xl">Sidan hittades inte</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Sidan du letar efter finns inte eller har flyttats.
        </p>
        <div className="mt-6">
          <Link to="/" className="btn-primary">
            Till startsidan
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="max-w-md text-center">
        <h1 className="text-2xl">Något gick fel</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Försök igen eller gå tillbaka till startsidan.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="btn-primary"
          >
            Försök igen
          </button>
          <a href="/" className="btn-ghost">
            Till start
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => {
    const softwareLd = {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "StayBoost",
      url: "https://stayboost.se/",
      description:
        "Bokningssystem och automatiserad merförsäljning för små boenden. Sälj tillval, skicka sms och samla den dagliga driften i StayBoost.",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      offers: [
        {
          "@type": "Offer",
          name: "Bokningssystem",
          price: "449",
          priceCurrency: "SEK",
        },
        {
          "@type": "Offer",
          name: "Allt i ett",
          price: "499",
          priceCurrency: "SEK",
        },
      ],
    };

    const faqItems = [
      [
        "Kan jag använda StayBoost med mitt nuvarande bokningssystem?",
        "Ja. Du kan börja med merförsäljningen och behålla din nuvarande bokningslösning, eller välja StayBoosts kompletta bokningssystem.",
      ],
      [
        "Behöver mina gäster ladda ner en app?",
        "Nej. Allt sker via vanliga sms och en webblänk som öppnas direkt i mobilen. Inget konto, ingen inloggning.",
      ],
      [
        "Hur lång tid tar det att komma igång?",
        "Du kan utforska produktdemon direkt utan konto. När du vill börja på riktigt hjälper vi dig att lägga in boenden, tillval och meddelanden i den takt som passar verksamheten.",
      ],
      [
        "Vad händer om en gäst svarar på ett sms?",
        'Du får svaret direkt i din inkorg i StayBoost och kan svara därifrån — eller låta automatiken hantera vanliga svar som "JA" på ett tillval.',
      ],
      [
        "Kan jag skriva mina egna meddelanden?",
        "Självklart. Mallarna är en start — varje meddelande går att redigera, och du kan bygga egna flöden med dina egna ord.",
      ],
      ["Kostar sms extra?", "Sms ingår och kostar inget extra per skickat meddelande."],
      [
        "Funkar det för min personal?",
        "Ja — det är halva poängen. Frukost- och städvyerna har egna enkla inloggningar, funkar i mobilen och finns på flera språk. Personalen ser exakt vad som ska göras: antal portioner, allergier, handdukar per tält.",
      ],
      [
        "Kan gäster hyra saker själva, som SUP eller bastu?",
        "Ja. Skapa ett tillval med kodlås: gästen betalar i mobilen och får koden direkt. Perfekt för SUP, bastu, cyklar och annat som inte kräver att du är på plats.",
      ],
      [
        "Kan jag köpa enbart merförsäljningsdelen?",
        "Ja. Merförsäljning kostar 2 procent per genomförd transaktion, utan månadsavgift. Sms ingår. Du kan också välja enbart bokningssystemet eller samla allt i ett paket.",
      ],
    ];

    const faqLd = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqItems.map(([q, a]) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    };

    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
        { title: "StayBoost — Bokning och merförsäljning för små boenden" },
        {
          name: "description",
          content:
            "Bokningssystem och automatiserad merförsäljning för små boenden. Sälj tillval, skicka sms och samla den dagliga driften i StayBoost.",
        },
        {
          property: "og:title",
          content: "StayBoost — Bokning och merförsäljning för små boenden",
        },
        {
          property: "og:description",
          content:
            "Ta emot bokningar, sälj fler tillval och ge gästen rätt information i rätt tid.",
        },
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: "StayBoost" },
        { property: "og:locale", content: "sv_SE" },
        { property: "og:image", content: "https://stayboost.se/og-image.png" },
        { name: "twitter:card", content: "summary_large_image" },
        {
          name: "twitter:title",
          content: "StayBoost — Bokning och merförsäljning för små boenden",
        },
        {
          name: "twitter:description",
          content:
            "Ta emot bokningar, sälj fler tillval och ge gästen rätt information i rätt tid.",
        },
        { name: "twitter:image", content: "https://stayboost.se/og-image.png" },
        {
          name: "google-site-verification",
          content: "qQp-5rS0NEPk0bognvzXuH7kaRD1etXS99sMYZKbq_Y",
        },
      ],
      links: [
        { rel: "stylesheet", href: appCss },
        { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,600&family=Inter:wght@400;500;600;700&display=swap",
        },
      ],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify(softwareLd),
        },
        {
          type: "application/ld+json",
          children: JSON.stringify(faqLd),
        },
      ],
    };
  },
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="sv">
      <head>
        <HeadContent />
        <meta
          name="google-site-verification"
          content="qQp-5rS0NEPk0bognvzXuH7kaRD1etXS99sMYZKbq_Y"
        />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useEffect(() => {
    initAnalytics();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}
