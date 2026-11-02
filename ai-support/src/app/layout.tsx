import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { DemoBanner } from "@/components/demo/DemoBanner";
import { ThemeSync } from "@/components/theme/ThemeSync";
import { themeInitScript } from "@/lib/theme/theme";
import "./globals.css";

// Fonts ship with the repo (latin variable files from @fontsource-variable,
// OFL-1.1, see src/app/fonts/README.md) so `next build` never calls Google.
const syne = localFont({
  src: "./fonts/syne/syne-latin-wght-normal.woff2",
  variable: "--font-display",
  weight: "500 800",
  style: "normal",
  display: "swap",
});

const figtree = localFont({
  src: "./fonts/figtree/figtree-latin-wght-normal.woff2",
  variable: "--font-body",
  weight: "400 700",
  style: "normal",
  display: "swap",
});

const jetbrainsMono = localFont({
  src: "./fonts/jetbrains-mono/jetbrains-mono-latin-wght-normal.woff2",
  variable: "--font-mono",
  weight: "400 500",
  style: "normal",
  display: "swap",
});

// Pages must not be written into the static output. A prerendered
// /dashboard (or /) can be served from the CDN without the proxy.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "VanOS — Mission Control",
  description:
    "Oversee agents, income, content, social, life, and systems — the VanOS command center.",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="system" suppressHydrationWarning>
      <head>
        <script id="vanos-theme-init" dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body
        className={`${syne.variable} ${figtree.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <ThemeSync />
        <DemoBanner />
        {children}
      </body>
    </html>
  );
}
