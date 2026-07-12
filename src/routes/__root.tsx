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
import { FAQ_ITEMS } from "../lib/faq";

const SITE_URL = "https://stayboost.se";

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
            type="button"
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
      url: SITE_URL,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description:
        "Gästkommunikation, tillval och arbetsvyer för glamping, stugor och små boenden.",
      offers: {
        "@type": "Offer",
        price: "449",
        priceCurrency: "SEK",
        availability: "https://schema.org/PreOrder",
      },
      provider: {
        "@type": "Organization",
        name: "Aurora Media AB",
        email: "info@auroramedia.se",
        address: {
          "@type": "PostalAddress",
          addressLocality: "Linköping",
          addressCountry: "SE",
        },
      },
    };

    const faqLd = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ_ITEMS.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    };

    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: "StayBoost — merförsäljning och enklare drift för små boenden" },
        {
          name: "description",
          content:
            "Automatiska gäst-SMS, tillval och enkla frukost- och städvyer för glamping, stugor och små boenden. Ansök om en pilotplats.",
        },
        { name: "robots", content: "index,follow,max-image-preview:large" },
        {
          property: "og:title",
          content: "StayBoost — sälj mer till varje gäst utan mer administration",
        },
        {
          property: "og:description",
          content:
            "Gästkommunikation, tillval och arbetsvyer för glamping, stugor och små boenden.",
        },
        { property: "og:type", content: "website" },
        { property: "og:locale", content: "sv_SE" },
        { property: "og:url", content: SITE_URL },
        { property: "og:image", content: `${SITE_URL}/og-image.png` },
        { name: "twitter:card", content: "summary_large_image" },
        {
          name: "twitter:title",
          content: "StayBoost — sälj mer till varje gäst utan mer administration",
        },
        {
          name: "twitter:description",
          content: "Gästkommunikation, tillval och arbetsvyer för små boenden.",
        },
        { name: "twitter:image", content: `${SITE_URL}/og-image.png` },
      ],
      links: [
        { rel: "canonical", href: SITE_URL },
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
        { type: "application/ld+json", children: JSON.stringify(softwareLd) },
        { type: "application/ld+json", children: JSON.stringify(faqLd) },
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
