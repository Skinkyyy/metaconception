import type { Metadata } from "next";
import RealisationsGallery from "@/components/RealisationsGallery";
import { getProjets } from "@/sanity/queries";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Réalisations — Metaconception | Dessinateur-Concepteur en Architecture",
  description:
    "Découvrez les projets réalisés par Metaconception : maisons individuelles, rénovations, extensions, aménagements et collectifs dans le Gard et l'Hérault.",
};

// ─── COMPACT HERO ─────────────────────────────────────────────────────────────

function PageHero() {
  return (
    <section className="bg-anthracite pt-32 pb-20 px-6 relative overflow-hidden">
      {/* Watermark */}
      <span
        aria-hidden="true"
        className="absolute right-0 bottom-0 select-none text-[30vw] font-bold leading-none text-white/[0.025] pointer-events-none"
      >
        R
      </span>

      <div className="max-w-6xl mx-auto relative">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-muted/50 text-[10px] tracking-[0.2em] uppercase mb-10">
          <a href="/" className="hover:text-muted transition-colors duration-200">
            Accueil
          </a>
          <span>/</span>
          <span className="text-terracotta">Réalisations</span>
        </nav>

        <p className="text-terracotta text-[10px] font-medium tracking-[0.28em] uppercase mb-4">
          Portfolio
        </p>
        <h1 className="text-warm-white font-extralight text-5xl sm:text-6xl md:text-7xl leading-[1.06]">
          Nos <span className="font-semibold">réalisations</span>
        </h1>
        <div className="w-14 h-px bg-terracotta mt-7 mb-8" />
        <p className="text-muted text-base sm:text-lg leading-relaxed max-w-lg">
          Une sélection de projets réalisés en Occitanie et alentours — maisons
          individuelles, rénovations, extensions, aménagements et opérations
          collectives.
        </p>
      </div>
    </section>
  );
}

// ─── CTA BOTTOM ───────────────────────────────────────────────────────────────

function CtaContact() {
  return (
    <section className="bg-warm-white border-t border-warm-gray py-20 px-6">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-8">
        <div>
          <p className="text-terracotta text-[10px] font-medium tracking-[0.28em] uppercase mb-3">
            Votre projet
          </p>
          <h2 className="text-anthracite text-3xl md:text-4xl font-light leading-snug">
            Vous avez un projet<br className="hidden sm:block" /> en tête ?
          </h2>
        </div>
        <a
          href="/#contact"
          className="shrink-0 bg-terracotta text-white text-[10px] font-semibold tracking-[0.2em] uppercase px-8 py-4 hover:bg-terracotta-dark transition-colors duration-200"
        >
          Nous contacter
        </a>
      </div>
    </section>
  );
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────

export default async function RealisationsPage() {
  const projets = await getProjets();

  return (
    <main>
      <PageHero />

      <section className="bg-warm-white py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <RealisationsGallery projets={projets} />
        </div>
      </section>

      <CtaContact />
    </main>
  );
}
