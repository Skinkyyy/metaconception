import type { Metadata } from "next";
import PluCalculator from "@/components/PluCalculator";

export const metadata: Metadata = {
  title: "Analyse PLU — Metaconception | Vérifiez les règles d'urbanisme",
  description:
    "Outil d'analyse PLU : estimez votre zone constructible, l'emprise au sol et les retraits réglementaires à partir des règles de votre Plan Local d'Urbanisme.",
};

function PageHero() {
  return (
    <section className="bg-anthracite pt-32 pb-20 px-6 relative overflow-hidden">
      <span
        aria-hidden="true"
        className="absolute right-0 bottom-0 select-none text-[30vw] font-bold leading-none text-white/[0.025] pointer-events-none"
      >
        PLU
      </span>

      <div className="max-w-6xl mx-auto relative">
        <nav className="flex items-center gap-2 text-muted/50 text-[10px] tracking-[0.2em] uppercase mb-10">
          <a href="/" className="hover:text-muted transition-colors duration-200">
            Accueil
          </a>
          <span>/</span>
          <span className="text-terracotta">Analyse PLU</span>
        </nav>

        <div className="flex items-center gap-3 mb-5">
          <p className="text-terracotta text-[10px] font-medium tracking-[0.28em] uppercase">
            Urbanisme
          </p>
          <span className="inline-flex items-center gap-1.5 bg-amber-500/15 border border-amber-400/30 text-amber-300 text-[9px] font-semibold tracking-[0.2em] uppercase px-2.5 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            Bêta
          </span>
        </div>

        <h1 className="text-warm-white font-extralight text-5xl sm:text-6xl md:text-7xl leading-[1.06]">
          Analyse <span className="font-semibold">PLU</span>
        </h1>
        <div className="w-14 h-px bg-terracotta mt-7 mb-8" />
        <p className="text-muted text-base sm:text-lg leading-relaxed max-w-lg">
          Estimez votre zone constructible, l&apos;emprise au sol autorisée et les
          retraits réglementaires à partir des règles de votre Plan Local
          d&apos;Urbanisme.
        </p>
      </div>
    </section>
  );
}

function BetaBanner() {
  return (
    <section className="bg-[#1a1712] border-b border-amber-900/20 px-6 py-10">
      <div className="max-w-6xl mx-auto">
        <div className="grid md:grid-cols-[1fr_auto] gap-8 items-start">

          {/* Texte principal */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <svg className="w-4 h-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
              </svg>
              <span className="text-amber-400 text-[10px] font-semibold tracking-[0.25em] uppercase">
                Outil en phase de test
              </span>
            </div>

            <p className="text-[#b8a98a] text-sm leading-relaxed max-w-xl">
              Cet analyseur PLU est actuellement en <span className="text-warm-white font-medium">version bêta</span>.
              Il est pleinement fonctionnel, mais peut encore présenter des imperfections.
              Vos retours d&apos;expérience sont essentiels pour nous permettre de l&apos;améliorer
              et de mieux répondre aux besoins des professionnels et particuliers.
            </p>

            {/* Liste des fonctionnalités */}
            <ul className="mt-5 grid sm:grid-cols-2 gap-x-8 gap-y-2">
              {[
                "Sélection de parcelle cadastrale",
                "Analyse IA des règles PLU",
                "Calcul des zones constructibles",
                "Estimation de l'emprise au sol",
                "Dessin du projet sur plan",
                "Rapport PDF par email",
              ].map((item) => (
                <li key={item} className="flex items-center gap-2 text-[11px] text-[#8a7a66]">
                  <span className="w-1 h-1 rounded-full bg-terracotta shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Encadré contact */}
          <div className="bg-[#221e18] border border-[#3a3228] rounded-sm p-5 min-w-[240px]">
            <p className="text-[10px] font-semibold tracking-[0.2em] uppercase text-terracotta mb-3">
              Partagez votre avis
            </p>
            <p className="text-[#8a7a66] text-xs leading-relaxed mb-4">
              Retours, suggestions ou signalement de bugs — toutes les remarques sont les bienvenues.
            </p>
            <a
              href="mailto:web@metaconception.eu"
              className="group flex items-center gap-2 text-warm-white text-sm font-medium hover:text-terracotta transition-colors duration-200"
            >
              <svg className="w-3.5 h-3.5 text-terracotta shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
              web@metaconception.eu
            </a>
            <div className="mt-4 pt-4 border-t border-[#3a3228]">
              <p className="text-[10px] text-[#5a5246] leading-relaxed">
                Les résultats sont indicatifs et ne constituent pas un avis juridique ou administratif.
              </p>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}

export default function PluPage() {
  return (
    <main>
      <PageHero />
      <BetaBanner />

      <section className="bg-warm-white py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <PluCalculator />
        </div>
      </section>
    </main>
  );
}
