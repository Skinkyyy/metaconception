"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

export default function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("cookie_consent");
    if (!stored) setVisible(true);
  }, []);

  function accept() {
    localStorage.setItem("cookie_consent", "accepted");
    setVisible(false);
  }

  function refuse() {
    localStorage.setItem("cookie_consent", "refused");
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[9998] bg-[#221e18] text-white border-t border-[#3a3530] px-4 py-4 sm:px-6"
      role="dialog"
      aria-label="Bandeau de consentement aux cookies"
    >
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <p className="text-sm text-[#c8bfb0] leading-relaxed flex-1">
          Ce site utilise des cookies strictement nécessaires à son fonctionnement.
          Aucun cookie de traçage publicitaire n&apos;est utilisé.{" "}
          <Link
            href="/mentions-legales"
            className="underline text-[#c8bfb0] hover:text-white transition-colors"
          >
            En savoir plus
          </Link>
        </p>
        <div className="flex gap-3 shrink-0">
          <button
            type="button"
            onClick={refuse}
            className="text-xs font-semibold tracking-[0.15em] uppercase px-5 py-2.5 border border-[#5a5246] text-[#c8bfb0] hover:border-[#8a8070] hover:text-white transition-colors"
          >
            Refuser
          </button>
          <button
            type="button"
            onClick={accept}
            className="text-xs font-semibold tracking-[0.15em] uppercase px-5 py-2.5 bg-[#b5651d] text-white hover:bg-[#9e5518] transition-colors"
          >
            Accepter
          </button>
        </div>
      </div>
    </div>
  );
}
