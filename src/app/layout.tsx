import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Newsreader, Source_Sans_3 } from "next/font/google";
import { DESCRIPTION, SITE, TITLE } from "@/lib/site";
import "./globals.css";

const sans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
});

const serif = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  axes: ["opsz"],
  style: ["normal", "italic"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    title: TITLE,
    description: DESCRIPTION,
    siteName: "Anatomy 2.0",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf7" },
    { media: "(prefers-color-scheme: dark)", color: "#131311" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
