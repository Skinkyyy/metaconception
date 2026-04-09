import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Nav from "@/components/Nav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Metaconception — Dessinateur-Concepteur en Architecture | Junas, Gard",
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
    "Montpellier",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Nav />
        {children}
      </body>
    </html>
  );
}
