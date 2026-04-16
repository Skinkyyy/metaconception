"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { urlFor } from "@/sanity/image";
import type { SanityProjet } from "@/sanity/queries";

// ─── TYPES ────────────────────────────────────────────────────────────────────

type Category =
  | "Tous"
  | "Maison individuelle"
  | "Rénovation"
  | "Extension"
  | "Aménagement"
  | "Opérations immobilières"
  | "Déclaration préalable"
  | "Vidéos";

const CATEGORIES: Category[] = [
  "Tous",
  "Maison individuelle",
  "Rénovation",
  "Extension",
  "Aménagement",
  "Opérations immobilières",
  "Déclaration préalable",
  "Vidéos",
];

// ─── BLUEPRINT SVG PATTERNS (3 variants) ─────────────────────────────────────

function PatternHouse() {
  return (
    <svg
      viewBox="0 0 200 150"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="absolute inset-0 w-full h-full opacity-[0.09]"
    >
      <path d="M20 130V65L100 22L180 65V130" stroke="white" strokeWidth="0.8" />
      <rect x="72" y="88" width="56" height="42" stroke="white" strokeWidth="0.7" />
      <rect x="90" y="104" width="20" height="26" stroke="white" strokeWidth="0.5" />
      <line x1="100" y1="22" x2="100" y2="130" stroke="white" strokeWidth="0.3" strokeDasharray="4 5" />
      <line x1="20" y1="80" x2="180" y2="80" stroke="white" strokeWidth="0.3" strokeDasharray="4 5" />
      <line x1="10" y1="130" x2="190" y2="130" stroke="white" strokeWidth="1.2" />
      <line x1="20" y1="22" x2="20" y2="16" stroke="white" strokeWidth="0.5" />
      <line x1="180" y1="22" x2="180" y2="16" stroke="white" strokeWidth="0.5" />
      <line x1="20" y1="16" x2="180" y2="16" stroke="white" strokeWidth="0.4" />
    </svg>
  );
}

function PatternPlan() {
  return (
    <svg
      viewBox="0 0 200 150"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="absolute inset-0 w-full h-full opacity-[0.09]"
    >
      <rect x="12" y="12" width="176" height="126" stroke="white" strokeWidth="0.8" />
      <rect x="28" y="28" width="72" height="56" stroke="white" strokeWidth="0.6" />
      <rect x="108" y="28" width="64" height="56" stroke="white" strokeWidth="0.6" />
      <rect x="28" y="92" width="144" height="38" stroke="white" strokeWidth="0.6" />
      <path d="M28 84 Q28 92 38 92" stroke="white" strokeWidth="0.5" fill="none" />
      <path d="M100 28 Q108 28 108 38" stroke="white" strokeWidth="0.5" fill="none" />
      <line x1="12" y1="88" x2="188" y2="88" stroke="white" strokeWidth="0.3" strokeDasharray="3 5" />
      <line x1="100" y1="12" x2="100" y2="138" stroke="white" strokeWidth="0.3" strokeDasharray="3 5" />
      <circle cx="100" cy="88" r="3" stroke="white" strokeWidth="0.4" fill="none" />
    </svg>
  );
}

function PatternSection() {
  return (
    <svg
      viewBox="0 0 200 150"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="absolute inset-0 w-full h-full opacity-[0.09]"
    >
      <path
        d="M10 130V62H58V42H102V62H158V80H190V130Z"
        stroke="white"
        strokeWidth="0.8"
      />
      <line x1="10" y1="130" x2="190" y2="130" stroke="white" strokeWidth="1.2" />
      <polyline
        points="58,130 58,120 73,120 73,110 88,110 88,100 102,100"
        stroke="white"
        strokeWidth="0.5"
      />
      <rect x="18" y="82" width="20" height="14" stroke="white" strokeWidth="0.5" />
      <rect x="112" y="66" width="20" height="14" stroke="white" strokeWidth="0.5" />
      <rect x="165" y="90" width="16" height="14" stroke="white" strokeWidth="0.5" />
      <line x1="102" y1="42" x2="102" y2="130" stroke="white" strokeWidth="0.3" strokeDasharray="3 4" />
    </svg>
  );
}

const PATTERNS = [PatternHouse, PatternPlan, PatternSection];

// ─── PROJECT CARD ─────────────────────────────────────────────────────────────

function ProjectCard({ project, index }: { project: SanityProjet; index: number }) {
  const Pattern = PATTERNS[index % 3];
  const imageUrl = project.imageprincipale
    ? urlFor(project.imageprincipale).width(800).height(600).url()
    : null;

  return (
    <Link href={`/realisations/${project.slug}`} className="group block">
      <article>
        {/* Image / placeholder */}
        <div className="aspect-[4/3] bg-anthracite relative overflow-hidden">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={`${project.titre} — ${project.localisation}`}
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-700"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            />
          ) : (
            <>
              <Pattern />
              <span className="absolute top-4 right-4 text-muted/30 text-[10px] font-mono tracking-widest select-none">
                #{String(index + 1).padStart(2, "0")}
              </span>
            </>
          )}

          {/* Slide-up overlay on hover */}
          <div className="absolute inset-0 bg-terracotta/90 translate-y-full group-hover:translate-y-0 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] flex flex-col justify-end p-6">
            <p className="text-white/60 text-[9px] tracking-[0.22em] uppercase mb-2">
              {project.annee}{project.surface && ` · ${project.surface}`}
            </p>
            <h3 className="text-white text-xl font-semibold leading-snug">
              {project.titre}
            </h3>
            <p className="text-white/75 text-sm mt-1.5">{project.localisation}</p>
            <p className="mt-5 text-white/45 text-[10px] tracking-[0.2em] uppercase flex items-center gap-2">
              Voir le projet <span aria-hidden>→</span>
            </p>
          </div>
        </div>

        {/* Info below image */}
        <div className="pt-4 pb-1">
          <span className="text-terracotta text-[9px] font-medium tracking-[0.2em] uppercase">
            {project.categorie}
          </span>
          <h3 className="text-anthracite font-semibold text-base mt-1 leading-snug group-hover:text-terracotta transition-colors duration-200">
            {project.titre}
          </h3>
          <p className="text-muted text-sm mt-0.5">
            {project.localisation} · {project.annee}
          </p>
        </div>
      </article>
    </Link>
  );
}

// ─── GALLERY ─────────────────────────────────────────────────────────────────

export default function RealisationsGallery({ projets }: { projets: SanityProjet[] }) {
  const [filter, setFilter] = useState<Category>("Tous");

  const filtered =
    filter === "Tous"
      ? projets
      : filter === "Vidéos"
      ? projets.filter((p) => p.video)
      : projets.filter((p) => p.categorie === filter);

  return (
    <div>
      {/* Filter buttons */}
      <div className="flex flex-wrap gap-2 mb-10">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={`text-[9px] font-semibold tracking-[0.2em] uppercase px-4 py-2.5 transition-all duration-200 ${
              filter === cat
                ? "bg-terracotta text-white"
                : "border border-warm-gray text-muted hover:border-terracotta hover:text-terracotta"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Count */}
      <p className="text-muted/45 text-xs tracking-wide mb-10">
        {filtered.length} projet{filtered.length > 1 ? "s" : ""}
        {filter !== "Tous" && (
          <span className="text-muted/30"> · {filter}</span>
        )}
      </p>

      {/* Grid */}
      {filtered.length === 0 ? (
        <p className="text-muted text-sm">Aucun projet dans cette catégorie pour l&apos;instant.</p>
      ) : (
        <div
          key={filter}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-12"
          style={{ animation: "fadeIn 0.35s ease-out both" }}
        >
          {filtered.map((project, i) => (
            <ProjectCard key={project._id} project={project} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
