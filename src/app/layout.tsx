import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import NavWrapper from "@/components/NavWrapper";
import CookieBanner from "@/components/CookieBanner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://metaconception.eu"),
  title: {
    default: "Metaconception — Dessinateur-Concepteur en Architecture | Junas, Gard",
    template: "%s — Metaconception",
  },
  description:
    "Metaconception, dessinateur-concepteur basé à Junas (30250, Gard). 15 ans d'expérience en conception architecturale, permis de construire, plans architecturaux, modélisation 3D.",
  keywords: [
    "dessinateur concepteur",
    "architecture",
    "permis de construire",
    "plans architecturaux",
    "modélisation 3D",
    "Junas",
    "Gard",
    "Hérault",
    "Occitanie",
    "extension maison",
    "rénovation",
    "déclaration préalable",
  ],
  openGraph: {
    type: "website",
    locale: "fr_FR",
    url: "https://metaconception.eu",
    siteName: "Metaconception",
    title: "Metaconception — Dessinateur-Concepteur en Architecture",
    description:
      "Dessinateur-concepteur basé à Junas, Gard. Maisons individuelles, extensions, rénovations, permis de construire en Occitanie.",
    images: [
      {
        url: "/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "Metaconception — Dessinateur-Concepteur en Architecture",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Metaconception — Dessinateur-Concepteur en Architecture",
    description:
      "Dessinateur-concepteur basé à Junas, Gard. Maisons individuelles, extensions, rénovations en Occitanie.",
    images: ["/og-image.jpg"],
  },
  alternates: {
    canonical: "https://metaconception.eu",
  },
  robots: {
    index: true,
    follow: true,
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  name: "Metaconception",
  description:
    "Dessinateur-concepteur en architecture basé à Junas, Gard. Spécialisé en maisons individuelles, extensions, rénovations et permis de construire.",
  url: "https://metaconception.eu",
  email: "contact@metaconception.eu",
  address: {
    "@type": "PostalAddress",
    addressLocality: "Junas",
    postalCode: "30250",
    addressRegion: "Gard",
    addressCountry: "FR",
  },
  geo: {
    "@type": "GeoCoordinates",
    latitude: 43.7667,
    longitude: 4.1167,
  },
  areaServed: ["Gard", "Hérault", "Vaucluse", "Occitanie"],
  priceRange: "€€",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <NavWrapper />
        {children}
        <CookieBanner />
      </body>
    </html>
  );
}
