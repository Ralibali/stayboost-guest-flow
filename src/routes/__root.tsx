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
    const plausibleDomain =
      (typeof import.meta !== "undefined" &&
        (import.meta as unknown as { env?: Record<string, string> }).env
          ?.VITE_PUBLIC_PLAUSIBLE_DOMAIN) ||
      "stayboost.se";

    const softwareLd = {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "StayBoost",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      offers: {
        "@type": "Offer",
        price: "449",
        priceCurrency: "SEK",
      },
    };

    const faqItems = [
      [
        "Fungerar det med Sirvoy och Booking.com?",
        "Ja. StayBoost hämtar dina bokningar automatiskt. Har du ett annat system kan du lägga in bokningar manuellt på under en minut.",
      ],
      [
        "Behöver mina gäster ladda ner en app?",
        "Nej. Allt sker via vanliga sms och en webblänk som öppnas direkt i mobilen. Inget konto, ingen inloggning.",
      ],
      [
        "Hur lång tid tar det att komma igång?",
        "En kväll. Koppla bokningarna, välj bland färdiga mallar, klart. De flesta skickar sitt första automatiska meddelande samma dag.",
      ],
      [
        "Vad händer om en gäst svarar på ett sms?",
        'Du får svaret direkt i din inkorg i StayBoost och kan svara därifrån — eller låta automatiken hantera vanliga svar som "JA" på ett tillval.',
      ],
      [
        "Kan jag skriva mina egna meddelanden?",
        "Självklart. Mallarna är en start — varje meddelande går att redigera, och du kan bygga egna flöden med dina egna ord.",
      ],
      [
        "Vad kostar sms:en?",
        "Sms ingår upp till en generös månadsgräns som räcker för de allra flesta små anläggningar. Går du över betalar du bara självkostnadspris per sms — inga påslag, inga överraskningar.",
      ],
      [
        "Funkar det för min personal?",
        "Ja — det är halva poängen. Frukost- och städvyerna har egna enkla inloggningar, funkar i mobilen och finns på flera språk. Personalen ser exakt vad som ska göras: antal portioner, allergier, handdukar per tält.",
      ],
      [
        "Kan gäster hyra saker själva, som SUP eller bastu?",
        "Ja. Skapa ett tillval med kodlås: gästen betalar i mobilen och får koden direkt. Perfekt för SUP, bastu, cyklar och annat som inte kräver att du är på plats.",
      ],
      [
        "Vi använder inte Sirvoy — funkar det ändå?",
        "Ja. Booking.com och manuell inmatning stöds, och fler kopplingar är på väg. Säg till vilken du behöver.",
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
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: "StayBoost — Hela driften för små boenden i ett system" },
        {
          name: "description",
          content:
            "Gästresa, tillval, incheckning, frukost och städ — hela driften för små boenden i ett system. Prova gratis i 14 dagar.",
        },
        {
          property: "og:title",
          content: "StayBoost — Hela driften för små boenden i ett system",
        },
        {
          property: "og:description",
          content:
            "Gästresa, tillval, incheckning, frukost och städ — hela driften för små boenden i ett system.",
        },
        { property: "og:type", content: "website" },
        { property: "og:image", content: "/og-image.png" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: "StayBoost — Hela driften för små boenden i ett system" },
        {
          name: "twitter:description",
          content:
            "Gästresa, tillval, incheckning, frukost och städ — hela driften för små boenden i ett system.",
        },
        { name: "twitter:image", content: "/og-image.png" },
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
          defer: true,
          "data-domain": plausibleDomain,
          src: "https://plausible.io/js/script.js",
        },
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

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}
