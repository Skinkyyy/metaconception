import type { Metadata } from "next";
import { Suspense } from "react";
import PluEntryClient from "./PluEntryClient";

export const metadata: Metadata = {
  title: "Plan de masse — Metaconception | Outil de dessin parcellaire",
  description: "Dessinez votre plan de masse, vérifiez la conformité PLU et exportez vos cotations.",
};

export default function PluPage() {
  return (
    <Suspense fallback={<div className="h-screen bg-[#0d1a10]" />}>
      <PluEntryClient />
    </Suspense>
  );
}
