import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";

const poppins = Poppins({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], variable: "--font-sans" });

export const metadata: Metadata = { title: { default: APP_NAME, template: `%s · ${APP_NAME}` }, description: APP_TAGLINE };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={poppins.variable}>
      <body>{children}</body>
    </html>
  );
}
