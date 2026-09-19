import type { Metadata, Viewport } from "next";
import { Doto, Jersey_10, Schibsted_Grotesk, Silkscreen } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { MobileNav } from "@/components/MobileNav";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader, type HeaderStatus } from "@/components/SiteHeader";
import { getLeagueContext } from "@/lib/league";
import { leagueStatus } from "./_lib/status";
import "./globals.css";

const jersey = Jersey_10({ weight: "400", subsets: ["latin"], variable: "--font-jersey", display: "swap" });
const silkscreen = Silkscreen({ weight: "400", subsets: ["latin"], variable: "--font-silkscreen", display: "swap" });
const doto = Doto({ weight: "900", subsets: ["latin"], variable: "--font-doto", display: "swap" });
const schibsted = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-schibsted", display: "swap" });

export const metadata: Metadata = {
  title: { default: "MSTP Dynasty", template: "%s | MSTP Dynasty" },
  description: "Live scores, win odds and a roast for every bad decision in the MSTP Dynasty fantasy league.",
  applicationName: "MSTP Dynasty",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", type: "image/png", sizes: "32x32" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    title: "MSTP Dynasty",
    description: "Live scores, win odds and a roast for every bad decision in the league.",
    siteName: "MSTP Dynasty",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0a",
  colorScheme: "light",
};

const MOTION_GATE = `document.visibilityState==="visible"&&document.documentElement.setAttribute("data-motion","on")`;

async function headerState(): Promise<{ status: HeaderStatus; isDevLeague: boolean; focus: "draft" | "scores" }> {
  try {
    const ctx = await getLeagueContext();
    return {
      status: leagueStatus(ctx),
      isDevLeague: ctx.isDevLeague,
      focus: ctx.phase === "pre_draft" || ctx.phase === "drafting" ? "draft" : "scores",
    };
  } catch {
    return { status: { primary: "Sleeper is not answering", secondary: "Scores will be back" }, isDevLeague: false, focus: "scores" };
  }
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { status, isDevLeague, focus } = await headerState();
  return (
    <html
      lang="en"
      className={`${jersey.variable} ${silkscreen.variable} ${doto.variable} ${schibsted.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Load motion only for a page that is on screen at first paint. See globals.css. */}
        <script dangerouslySetInnerHTML={{ __html: MOTION_GATE }} />
      </head>
      <body className="min-h-dvh bg-paper pb-[calc(3.75rem+env(safe-area-inset-bottom))] text-ink md:pb-0">
        <a href="#main" className="skip-link">
          Skip to the roast
        </a>
        <SiteHeader status={status} isDevLeague={isDevLeague} />
        <main id="main">{children}</main>
        <SiteFooter />
        <MobileNav focus={focus} />
        <Analytics />
      </body>
    </html>
  );
}
