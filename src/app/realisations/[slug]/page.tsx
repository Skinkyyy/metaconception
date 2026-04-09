import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProjetBySlug, getProjetsSlug } from "@/sanity/queries";
import { urlFor } from "@/sanity/image";

export const revalidate = 60;

// ─── STATIC PARAMS ────────────────────────────────────────────────────────────

export async function generateStaticParams() {
  const slugs = await getProjetsSlug();
  return slugs.map((s) => ({ slug: s.slug }));
}

// ─── METADATA ─────────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const projet = await getProjetBySlug(slug);
  if (!projet) return {};
  return {
    title: `${projet.titre} — Metaconception`,
    description: projet.description ?? `${projet.titre} · ${projet.localisation} · ${projet.annee}`,
  };
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────

export default async function ProjetPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const projet = await getProjetBySlug(slug);
  if (!projet) notFound();

  const ficheItems = [
    { label: "Localisation", value: projet.localisation },
    { label: "Année", value: projet.annee },
    { label: "Surface", value: projet.surface },
    { label: "Typologie", value: projet.typologie },
    { label: "Mission", value: projet.mission },
    { label: "Avancement", value: projet.avancement },
  ].filter((item) => item.value);

  // Fusionner galerie + plans en une seule liste
  const medias = [
    ...(projet.galerie ?? []).map((img) => ({ ...img, type: "photo" as const })),
    ...(projet.plans ?? []).map((img) => ({ ...img, type: "plan" as const })),
  ].filter((media) => media.asset);

  return (
    <main>
      {/* ── En-tête ── */}
      <section className="bg-anthracite pt-32 pb-16 px-6">
        <div className="max-w-6xl mx-auto">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-2 text-muted/50 text-[10px] tracking-[0.2em] uppercase mb-10">
            <Link href="/" className="hover:text-muted transition-colors">Accueil</Link>
            <span>/</span>
            <Link href="/realisations" className="hover:text-muted transition-colors">Réalisations</Link>
            <span>/</span>
            <span className="text-terracotta">{projet.titre}</span>
          </nav>

          <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-16 items-start">
            {/* Titre + description */}
            <div>
              <p className="text-terracotta text-[10px] font-medium tracking-[0.28em] uppercase mb-3">
                {projet.categorie}
              </p>
              <h1 className="text-warm-white text-4xl md:text-5xl font-light leading-[1.1] mb-6">
                {projet.titre}
              </h1>
              <div className="w-14 h-px bg-terracotta mb-8" />
              {projet.description && (
                <p className="text-muted leading-relaxed text-base whitespace-pre-wrap">
                  {projet.description}
                </p>
              )}
            </div>

            {/* Fiche technique */}
            <div className="bg-anthracite-mid p-8">
              <p className="text-terracotta text-[9px] tracking-[0.28em] uppercase mb-6 font-medium">
                Fiche technique
              </p>
              <dl className="space-y-4">
                {ficheItems.map((item) => (
                  <div key={item.label}>
                    <dt className="text-muted/60 text-[10px] tracking-widest uppercase mb-1">
                      {item.label}
                    </dt>
                    <dd className="text-warm-white text-sm">{item.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </section>

      {/* ── Visuels (galerie + plans réunis) ── */}
      {medias.length > 0 && (
        <section className="bg-warm-white py-20 px-6">
          <div className="max-w-4xl mx-auto space-y-6">
            {medias.map((media, i) => {
              const url = urlFor(media).width(1200).url();
              return (
                <div key={i} className="bg-anthracite overflow-hidden">
                  <Image
                    src={url}
                    alt={media.caption ?? `Visuel ${i + 1} — ${projet.titre}`}
                    width={1200}
                    height={900}
                    className="w-full h-auto"
                    sizes="(max-width: 1024px) 100vw, 896px"
                  />
                  {media.caption && (
                    <div className="px-5 py-3 border-t border-anthracite-soft">
                      <p className="text-muted text-xs tracking-wide">
                        {media.type === "plan" && (
                          <span className="text-terracotta mr-2 text-[9px] uppercase tracking-widest">Plan ·</span>
                        )}
                        {media.caption}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Navigation retour ── */}
      <section className="bg-warm-white border-t border-warm-gray py-16 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link
            href="/realisations"
            className="text-muted hover:text-anthracite transition-colors text-sm flex items-center gap-2"
          >
            <span aria-hidden>←</span> Retour aux réalisations
          </Link>
          <Link
            href="/#contact"
            className="bg-terracotta text-white text-[10px] font-semibold tracking-[0.2em] uppercase px-8 py-4 hover:bg-terracotta-dark transition-colors duration-200"
          >
            Démarrer un projet
          </Link>
        </div>
      </section>
    </main>
  );
}
