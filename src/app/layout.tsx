import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic, Poppins } from "next/font/google";
import "./globals.css";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { dirOf, htmlLang } from "@/lib/i18n";
import { LangProvider } from "@/lib/i18n/context";
import { getLang } from "@/lib/i18n/server";
import { Suspense } from "react";
import { SessionWatch } from "@/components/shell/session-watch";

const poppins = Poppins({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], variable: "--font-sans" });
// Arabic letters come from this font; Latin letters and figures stay in Poppins in both languages.
const arabic = IBM_Plex_Sans_Arabic({ subsets: ["arabic"], weight: ["300", "400", "500", "600", "700"], variable: "--font-ar", preload: false });

export const metadata: Metadata = { title: { default: APP_NAME, template: `%s · ${APP_NAME}` }, description: APP_TAGLINE };

export const viewport: Viewport = { themeColor: "#0B6E70" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  return (
    <html lang={htmlLang(lang)} dir={dirOf(lang)} className={`${poppins.variable} ${arabic.variable}`}>
      <body><LangProvider lang={lang}>{children}<Suspense fallback={null}><SessionWatch /></Suspense></LangProvider></body>
    </html>
  );
}
