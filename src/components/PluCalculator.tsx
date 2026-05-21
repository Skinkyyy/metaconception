"use client";

import { useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import type { LotPolygon, AccessPoint, Building, DrawnShape, ManualMeasure } from "./MapPicker";
import { SHAPE_LABELS, SHAPE_DOT_CLS, NIVEAUX_DOT_CLS } from "./shapeConstants";
import { computeOffsetPoly, classifyEdgeSetbacks } from "@/lib/zoneUtils";

// Tailwind classes pour les types de forme et niveaux (statiques pour que Tailwind les inclue)
const SHAPE_SELECTED_CLS: Record<string, string> = {
  batiment:  "bg-blue-600 border-blue-600",
  extension: "bg-violet-700 border-violet-700",
  garage:    "bg-slate-600 border-slate-600",
  piscine:   "bg-cyan-600 border-cyan-600",
  terrasse:  "bg-amber-600 border-amber-600",
  autre:     "bg-green-700 border-green-700",
};
// keeps Tailwind: bg-blue-600 bg-amber-400 bg-red-600 bg-slate-500 bg-violet-700 bg-cyan-600 bg-green-700

const MapPicker = dynamic(() => import("./MapPicker"), { ssr: false });

// ─── Niveaux / hauteur ────────────────────────────────────────────────────────
type Niveaux = "rdc" | "r1" | "r2" | "annexe";

const NIVEAUX_LABELS: Record<Niveaux, string> = {
  rdc: "RDC", r1: "R+1", r2: "R+2", annexe: "Annexe",
};
const HAUTEUR_NIVEAUX: Record<Niveaux, number> = {
  rdc: 3.5, r1: 6.5, r2: 9.5, annexe: 2.5,
};

// ─── Types ─────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4;

type GeoFeature = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
};

interface LotissementAnalysis {
  resume: string;
  retraitVoie: number;
  retraitLateral: number;
  retraitFond: number;
  empriseMax: number;
  hauteurMax: number;
  parkingNombrePlaces: number;
  parkingOuvertSurVoirie: boolean;
  parkingDetails: string;
  reglesArchitecturales: string[];
  autresRegles: string[];
  avertissement: string;
}

interface AiAnalysis {
  resume: string;
  retraitVoie: number;
  retraitLateral: number;
  retraitFond: number;
  empriseMax: number;
  empriseNonReglementee?: boolean;
  hauteurMax: number;
  espacesLibresPct?: number;
  parkingNombrePlaces: number;
  parkingNonClose?: number;
  parkingOuvertSurVoirie: boolean;
  parkingDetails: string;
  pointsAttention: string[];
  recommandation: string;
  avertissement: string;
  recapSections?: { titre: string; items: string[] }[];
  annexesEnLimite?: { type: string; empriseMaxM2: number; hauteurMaxM: number }[];
  annexeRetraits?: { type: string; retraitLateral: number; retraitFond: number; enLimite: boolean; surfaceMaxM2?: number; hauteurMaxM?: number; note?: string }[];
  sourcePluOfficiel?: boolean;
  isZac?: boolean;
}

// ─── Project types ──────────────────────────────────────────────────────────

const PLU_TIPS = [
  {
    cat: "Permis de construire",
    text: "Une extension < 20 m² en zone urbaine ne nécessite qu'une déclaration préalable. Au-delà, ou si la surface totale dépasse 150 m², un permis de construire est obligatoire.",
  },
  {
    cat: "Règle H/2",
    text: "Le retrait latéral H/2 s'applique même si le PLU fixe un retrait inférieur : votre bâtiment doit toujours être écarté des limites voisines d'au moins la moitié de sa hauteur.",
  },
  {
    cat: "Emprise au sol",
    text: "L'emprise au sol inclut les débords de toit supérieurs à 60 cm. Pensez-y lors du choix de votre charpente — un avant-toit généreux peut réduire la surface constructible disponible.",
  },
  {
    cat: "Zones N et A",
    text: "En zone Naturelle (N) ou Agricole (A), les constructions sont très limitées — généralement un agrandissement plafonné à 30 % de l'existant, sans création de nouveau logement.",
  },
  {
    cat: "Piscine",
    text: "Piscine < 10 m² : aucune formalité. Entre 10 et 100 m² : déclaration préalable. Au-delà de 100 m² ou couverte > 1,80 m de hauteur : permis de construire obligatoire.",
  },
  {
    cat: "Surface de plancher",
    text: "La surface de plancher (SP) ne compte que les niveaux dont la hauteur sous plafond dépasse 1,80 m. Un sous-sol technique ou des combles non aménagés ne sont pas comptabilisés.",
  },
  {
    cat: "CPAP Lotissement",
    text: "Le Cahier des Prescriptions Architecturales et Paysagères d'un lotissement peut imposer des règles plus strictes que le PLU. En cas de conflit, c'est toujours la règle la plus restrictive qui s'applique.",
  },
  {
    cat: "Abri de jardin",
    text: "Un abri de jardin < 5 m² est dispensé de toute formalité. Entre 5 et 20 m², une déclaration préalable est requise. Au-delà de 20 m², un permis de construire est nécessaire.",
  },
  {
    cat: "Aspect extérieur",
    text: "Le PLU peut imposer des contraintes sur les matériaux, couleurs de façade et formes de toit. Vérifiez les articles « aspect extérieur » — un refus pour non-conformité esthétique est possible.",
  },
  {
    cat: "Recours des tiers",
    text: "Tout permis accordé peut être contesté par un voisin dans un délai de 2 mois après affichage sur le terrain. L'affichage réglementaire (panneau visible depuis la voie publique) est donc crucial.",
  },
  {
    cat: "Validité du permis",
    text: "Un permis de construire est valable 3 ans. Il peut être prorogé deux fois d'un an sur demande en mairie, à condition que les règles d'urbanisme n'aient pas évolué défavorablement.",
  },
  {
    cat: "RE2020",
    text: "Depuis le 1er janvier 2022, la réglementation RE2020 s'applique à toute construction neuve. Elle impose des seuils de performance énergétique et d'empreinte carbone plus exigeants que la RT2012.",
  },
  {
    cat: "Clôtures",
    text: "Les clôtures sont souvent réglementées par le PLU : hauteur maximale sur voie publique (fréquemment 1,60 m), nature des matériaux, couleur. Une déclaration préalable est parfois requise.",
  },
  {
    cat: "Servitude de vue",
    text: "Le Code civil impose 1,90 m de recul pour une fenêtre de vue droite sur la propriété voisine, et 0,60 m pour une vue oblique. Ces distances s'appliquent indépendamment du PLU.",
  },
  {
    cat: "Droit de préemption",
    text: "Dans les zones de préemption urbaine (ZPU), la commune peut se substituer à l'acheteur lors de la vente d'un terrain. Renseignez-vous en mairie avant d'engager des frais d'études.",
  },
  {
    cat: "Conformité des travaux",
    text: "À la fin des travaux, le dépôt d'une Déclaration Attestant l'Achèvement et la Conformité des Travaux (DAACT) en mairie est obligatoire. Cela déclenche le droit de visite de la mairie.",
  },
  {
    cat: "Mur mitoyen",
    text: "Un mur séparatif entre deux propriétés est présumé mitoyen : il appartient aux deux voisins. Toute modification ou surélévation requiert l'accord des deux parties ou un accord préalable.",
  },
  {
    cat: "Accès pompiers",
    text: "Tout bâtiment d'habitation doit être accessible aux engins de secours. Le PLU peut imposer une voie d'accès de largeur minimale (souvent 3 m), une hauteur libre suffisante et une aire de manœuvre.",
  },
  {
    cat: "Coefficient de biotope",
    text: "Certains PLU imposent un coefficient de biotope par surface (CBS) : une part minimale de la parcelle doit rester perméable ou végétalisée pour favoriser l'infiltration des eaux pluviales.",
  },
  {
    cat: "PLU intercommunal",
    text: "De nombreuses communes ont fusionné leur PLU en PLUi (intercommunal). Ce document couvre tout le territoire de l'intercommunalité et peut prévoir des règles différentes selon les secteurs.",
  },
  {
    cat: "Orientation solaire",
    text: "L'orientation d'un bâtiment influe directement sur sa performance énergétique. Un séjour exposé sud capte jusqu'à 4× plus d'énergie solaire en hiver qu'une façade nord — à anticiper dès la conception.",
  },
  {
    cat: "Toiture",
    text: "Le PLU peut réglementer la pente minimale de toiture, la nature des matériaux (tuile, ardoise, zinc…) et même la couleur. Ces contraintes varient fortement selon les communes.",
  },
  {
    cat: "Loi ALUR",
    text: "La loi ALUR (2014) a supprimé le COS (Coefficient d'Occupation des Sols) et le taille minimale de terrain. Désormais, seuls les retraits, l'emprise au sol et la hauteur encadrent le gabarit constructible.",
  },
] as const;

const PROJECT_TYPES = [
  { key: "construction_neuve", label: "Construction neuve",      desc: "Maison individuelle ou bâtiment neuf sur terrain nu" },
  { key: "agrandissement",     label: "Agrandissement",          desc: "Extension, surélévation ou ajout de surface à l'existant" },
  { key: "piscine",            label: "Piscine",                 desc: "Piscine enterrée ou semi-enterrée" },
  { key: "abri",               label: "Abri / Pergola / Véranda", desc: "Carport, abri de jardin, pergola ou véranda légère" },
  { key: "terrasse",           label: "Terrasse",                desc: "Terrasse de plain-pied ou surélevée" },
];

// ─── Wizard agrandissement ───────────────────────────────────────────────────

type AgrandSurface = "habitable" | "annexe";
type AgrandSeuil   = "lt20" | "20_40" | "gt40";

interface AgrandWizard {
  surface:    AgrandSurface | null;
  typeDetail: string | null;
  seuil:      AgrandSeuil | null;
}

const WIZARD_TYPES_HABITABLE = [
  { key: "surelevation",    label: "Surélévation / étage",        desc: "Ajout d'un niveau au-dessus de l'existant" },
  { key: "extension_rdc",   label: "Extension de plain-pied",     desc: "Nouvelle pièce accolée au rez-de-chaussée" },
  { key: "veranda",         label: "Véranda chauffée",            desc: "Structure vitrée attenante, habitée et chauffée" },
  { key: "garage_converti", label: "Conversion de garage",        desc: "Garage transformé en surface habitable" },
];
const WIZARD_TYPES_ANNEXE = [
  { key: "garage",          label: "Garage / Carport",            desc: "Abri couvert pour véhicule(s)" },
  { key: "abri_jardin",     label: "Abri de jardin / local",      desc: "Abri, remise, local technique" },
  { key: "atelier",         label: "Atelier / bureau",            desc: "Espace de travail ou studio annexe" },
  { key: "veranda_nc",      label: "Véranda non chauffée",        desc: "Structure vitrée froide, non habitée" },
];
const WIZARD_SEUILS = [
  { key: "lt20",   label: "Moins de 20 m²",     desc: "Déclaration préalable souvent suffisante" },
  { key: "20_40",  label: "De 20 à 40 m²",      desc: "Permis de construire requis" },
  { key: "gt40",   label: "Plus de 40 m²",       desc: "Permis de construire requis" },
];

function WizardStep({
  title, hint, options, value, onChange, cols = 2,
}: {
  title: string;
  hint?: string;
  options: { key: string; label: string; desc: string }[];
  value: string | null;
  onChange: (v: string) => void;
  cols?: 2 | 3 | 4;
}) {
  const gridClass = cols === 4 ? "grid-cols-2 sm:grid-cols-4" : cols === 3 ? "grid-cols-3" : "grid-cols-2";
  return (
    <div className="space-y-2 border-l-2 border-terracotta/30 pl-4">
      <div>
        <p className="text-sm font-medium text-anthracite">{title}</p>
        {hint && <p className="text-[11px] text-muted mt-0.5">{hint}</p>}
      </div>
      <div className={`grid ${gridClass} gap-2`}>
        {options.map((opt) => (
          <button key={opt.key} type="button" onClick={() => onChange(opt.key)}
            className={`text-left p-3 border transition-colors ${
              value === opt.key ? "border-terracotta bg-terracotta/5" : "border-warm-gray hover:border-terracotta/40"
            }`}>
            <p className="font-medium text-anthracite text-[13px] leading-tight">{opt.label}</p>
            <p className="text-[11px] text-muted leading-snug mt-0.5">{opt.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Wizard piscine ─────────────────────────────────────────────────────────

type PiscineType    = "enterree" | "horsol";
type PiscineSurface = "lt10" | "10_100" | "gt100";
type PiscineAbri    = "non" | "oui";

interface PiscineWizard {
  type:    PiscineType    | null;
  surface: PiscineSurface | null;
  abri:    PiscineAbri    | null;
}

const WIZARD_PISCINE_TYPES = [
  { key: "enterree", label: "Enterrée / semi-enterrée", desc: "Piscine creusée dans le sol, permanente" },
  { key: "horsol",   label: "Hors-sol",                 desc: "Structure démontable posée sur le sol" },
];
const WIZARD_PISCINE_SURFACES = [
  { key: "lt10",   label: "Moins de 10 m²",  desc: "Souvent dispensée d'autorisation" },
  { key: "10_100", label: "De 10 à 100 m²",  desc: "Déclaration préalable requise" },
  { key: "gt100",  label: "Plus de 100 m²",  desc: "Permis de construire requis" },
];
const WIZARD_PISCINE_ABRI = [
  { key: "non", label: "Sans abri / à ciel ouvert",       desc: "Piscine ouverte" },
  { key: "oui", label: "Avec abri ou couverture (> 1,80 m)", desc: "Permis de construire obligatoire" },
];

// ─── Wizard abri / pergola / véranda ────────────────────────────────────────

type AbriType        = "abri_jardin" | "carport" | "pergola" | "veranda";
type AbriSurface     = "lt5" | "5_20" | "gt20";
type AbriImplantation = "adosse" | "independant";

interface AbriWizard {
  type:         AbriType         | null;
  surface:      AbriSurface      | null;
  implantation: AbriImplantation | null;
}

const WIZARD_ABRI_TYPES = [
  { key: "abri_jardin", label: "Abri de jardin",        desc: "Local technique, remise, stockage" },
  { key: "carport",     label: "Carport / abri voiture", desc: "Couvert ouvert pour véhicule(s)" },
  { key: "pergola",     label: "Pergola",                desc: "Structure ouverte ou semi-ouverte" },
  { key: "veranda",     label: "Véranda légère",         desc: "Structure vitrée non chauffée" },
];
const WIZARD_ABRI_SURFACES = [
  { key: "lt5",  label: "Moins de 5 m²",   desc: "Souvent dispensé d'autorisation" },
  { key: "5_20", label: "De 5 à 20 m²",    desc: "Déclaration préalable requise" },
  { key: "gt20", label: "Plus de 20 m²",   desc: "Permis de construire requis" },
];
const WIZARD_ABRI_IMPLANTATION = [
  { key: "adosse",      label: "Adossé à la maison",      desc: "Accolé au bâtiment existant" },
  { key: "independant", label: "Indépendant dans le jardin", desc: "Construction autonome" },
];

// ─── Wizard terrasse ─────────────────────────────────────────────────────────

type TerrasseType      = "plainpied" | "surelevee";
type TerrasseSurface   = "lt20" | "20_40" | "gt40";
type TerrasseCouverture = "non" | "oui";

interface TerrasseWizard {
  type:       TerrasseType       | null;
  surface:    TerrasseSurface    | null;
  couverture: TerrasseCouverture | null;
}

const WIZARD_TERRASSE_TYPES = [
  { key: "plainpied", label: "De plain-pied",  desc: "Au niveau du sol naturel, hauteur ≤ 60 cm" },
  { key: "surelevee", label: "Surélevée",       desc: "Hauteur > 60 cm, plancher porteur" },
];
const WIZARD_TERRASSE_SURFACES = [
  { key: "lt20",  label: "Moins de 20 m²",  desc: "Souvent dispensée d'autorisation" },
  { key: "20_40", label: "De 20 à 40 m²",   desc: "Déclaration préalable probable" },
  { key: "gt40",  label: "Plus de 40 m²",   desc: "Permis de construire probable" },
];
const WIZARD_TERRASSE_COUVERTURE = [
  { key: "non", label: "À ciel ouvert",          desc: "Sans toiture ni couverture fixe" },
  { key: "oui", label: "Couverte (auvent, pergola)", desc: "Toiture fixe ou semi-fixe au-dessus" },
];

interface Suggestion {
  label: string;
  lon: number;
  lat: number;
}

interface CommuneSuggestion {
  label: string;
  codeInsee: string;
}

interface ParcelData {
  ref: string;
  surface: number;
  largeur: number;
  profondeur: number;
  coordinates: [number, number][];
  voie: string;
  centLon: number;
  centLat: number;
}

interface ZoneInfo {
  libelle: string;
  description: string;
  partition?: string;
  nomfic?: string;
  gpuDocId?: string;
}

interface Rules {
  retraitVoie: string;
  retraitLateral: string;
  retraitFond: string;
  empriseMax: string;
  hauteurMax: string;
}

// ─── API ───────────────────────────────────────────────────────────────────

async function searchBAN(q: string): Promise<Suggestion[]> {
  if (q.trim().length < 3) return [];
  try {
    const res = await fetch(`/api/ban-search?q=${encodeURIComponent(q)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.features ?? []).map((f: Record<string, unknown>) => {
      const props = f.properties as Record<string, unknown>;
      const geom = f.geometry as { coordinates: [number, number] };
      return { label: props.label as string, lon: geom.coordinates[0], lat: geom.coordinates[1] };
    });
  } catch { return []; }
}

async function searchCommune(q: string): Promise<CommuneSuggestion[]> {
  if (q.trim().length < 2) return [];
  try {
    const res = await fetch(`/api/ban-search?q=${encodeURIComponent(q)}&type=municipality`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.features ?? []).map((f: Record<string, unknown>) => {
      const props = f.properties as Record<string, unknown>;
      return { label: props.label as string, codeInsee: props.citycode as string };
    });
  } catch { return []; }
}

// ── BDTOPO — constructions existantes ──────────────────────────────────────

// Ray casting — ring et point en [lon, lat]
function pointInPolygon(lon: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

function geometryToWkt(geometry: { type: string; coordinates: unknown }): string | null {
  let ring: [number, number][] | null = null;
  if (geometry.type === "Polygon") ring = (geometry.coordinates as [number, number][][])[0];
  else if (geometry.type === "MultiPolygon") ring = (geometry.coordinates as [number, number][][][])[0][0];
  if (!ring || ring.length < 3) return null;
  const pts = [...ring];
  if (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1]) pts.push(pts[0]);
  return `POLYGON((${pts.map(([lon, lat]) => `${lon} ${lat}`).join(",")}))`;
}

function ringAreaM2(ring: [number, number][]): number {
  // ring: [lon, lat][]
  const avgLat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const kLat = 111320;
  const kLon = kLat * Math.cos((avgLat * Math.PI) / 180);
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    area += ring[i][0] * kLon * ring[i + 1][1] * kLat;
    area -= ring[i + 1][0] * kLon * ring[i][1] * kLat;
  }
  return Math.abs(area) / 2;
}

function formatUsage(usage: string): string {
  const u = usage.toLowerCase();
  if (u.includes("résidentiel")) return "Habitation";
  if (u.includes("commercial")) return "Commerce / Services";
  if (u.includes("industriel") || u.includes("agricole")) return "Industrie / Agriculture";
  if (u.includes("annexe")) return "Annexe";
  if (u.includes("sport") || u.includes("loisir")) return "Sport / Loisirs";
  if (u.includes("scolaire") || u.includes("enseignement")) return "Enseignement";
  if (u.includes("religieux")) return "Religieux";
  return usage || "Inconnu";
}

// ── Géométrie ───────────────────────────────────────────────────────────────

function geoDistM(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// WFS IGN Géoplateforme — endpoint de référence, gratuit, sans clé
const WFS_BASE = "https://data.geopf.fr/wfs/ows";
const WFS_LAYER = "CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle";

function featureToParcel(feature: Record<string, unknown>, voie: string): ParcelData {
  const p = feature.properties as Record<string, unknown>;
  const geom = feature.geometry as { type: string; coordinates: unknown };

  let coords: [number, number][];
  if (geom.type === "Polygon") {
    coords = (geom.coordinates as [number, number][][])[0];
  } else {
    coords = (geom.coordinates as [number, number][][][])[0][0];
  }

  const lons = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const midLat = (minLat + maxLat) / 2;
  const centLon = (minLon + maxLon) / 2;
  const centLat = midLat;
  const largeur = Math.round(geoDistM(midLat, minLon, midLat, maxLon));
  const profondeur = Math.round(geoDistM(minLat, centLon, maxLat, centLon));

  // Selon la source (API Carto ou WFS), les champs diffèrent
  const idu = (p.idu ?? "") as string;
  const codeInsee = idu.length >= 5 ? idu.slice(0, 5) : (p.code_insee ?? p.code_com ?? "") as string;
  const section = (p.section ?? (idu.length >= 7 ? idu.slice(5, 7) : "")) as string;
  const numero = (p.numero ?? (idu.length >= 11 ? idu.slice(7, 11) : "")) as string;

  return {
    ref: `${codeInsee} ${section} ${numero}`.trim(),
    surface: (p.contenance as number) ?? Math.round(largeur * profondeur),
    largeur,
    profondeur,
    coordinates: coords,
    voie,
    centLon,
    centLat,
  };
}

async function wfsFetch(params: Record<string, string>): Promise<Response> {
  // URLSearchParams encode les espaces en "+" — certains serveurs WFS
  // n'acceptent que "%20". On construit l'URL manuellement.
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return fetch(`${WFS_BASE}?${qs}`);
}

async function loadParcelByCoords(lon: number, lat: number, voie: string): Promise<ParcelData | null> {
  // Essai 1 : intersection point exacte avec colonne "geom" (IGN Géoplateforme)
  for (const geomCol of ["geom", "the_geom"]) {
    try {
      const res = await wfsFetch({
        SERVICE: "WFS", VERSION: "2.0.0", REQUEST: "GetFeature",
        outputFormat: "application/json",
        typeName: WFS_LAYER,
        count: "1",
        SRSNAME: "CRS:84",
        CQL_FILTER: `intersects(${geomCol},POINT(${lon} ${lat}))`,
      });
      if (res.ok) {
        const data = await res.json();
        if (data.features?.length) return featureToParcel(data.features[0], voie);
      }
    } catch { /* essai suivant */ }
  }

  // Essai 2 : BBOX très petit (~5 m) en dernier recours
  try {
    const d = 0.00005;
    const res = await wfsFetch({
      SERVICE: "WFS", VERSION: "2.0.0", REQUEST: "GetFeature",
      outputFormat: "application/json",
      typeName: WFS_LAYER,
      count: "1",
      SRSNAME: "CRS:84",
      BBOX: `${lon - d},${lat - d},${lon + d},${lat + d},CRS:84`,
    });
    if (res.ok) {
      const data = await res.json();
      if (data.features?.length) return featureToParcel(data.features[0], voie);
    }
  } catch { /* échec */ }

  return null;
}

async function loadParcelByRef(
  codeInsee: string,
  section: string,
  numero: string,
  communeLabel: string
): Promise<ParcelData | null> {
  try {
    const numPadded = numero.trim().padStart(4, "0");
    const sec = section.trim().toUpperCase().padStart(2, "0");
    // L'IDU = code_insee(5) + section(2) + numero(4)
    const idu = `${codeInsee}${sec}${numPadded}`;
    const params = new URLSearchParams({
      SERVICE: "WFS", VERSION: "2.0.0", REQUEST: "GetFeature",
      outputFormat: "application/json",
      typeName: WFS_LAYER,
      count: "1",
      SRSNAME: "CRS:84",
      CQL_FILTER: `idu='${idu}'`,
    });
    const res = await fetch(`${WFS_BASE}?${params}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.features?.length) return null;
    return featureToParcel(data.features[0], communeLabel);
  } catch {
    return null;
  }
}

async function loadZonePlu(lon: number, lat: number): Promise<ZoneInfo | null> {
  // Essai 1 : API Carto GPU — source officielle Géoportail Urbanisme
  // Le paramètre attendu est "geom" (GeoJSON), pas lon/lat séparés
  try {
    const geomParam = encodeURIComponent(JSON.stringify({ type: "Point", coordinates: [lon, lat] }));
    const res = await fetch(`https://apicarto.ign.fr/api/gpu/zone-urba?geom=${geomParam}`);
    if (res.ok) {
      const data = await res.json();
      if (data.features?.length) {
        const p = data.features[0].properties as Record<string, unknown>;
        return {
          libelle: (p.libelle ?? p.typezone ?? "—") as string,
          description: (p.libelong ?? "Zone non renseignée") as string,
          partition: (p.partition ?? "") as string,
          nomfic: (p.nomfic ?? "") as string,
          gpuDocId: (p.gpu_doc_id ?? "") as string,
        };
      }
    }
  } catch { /* essai suivant */ }

  // Essai 2 : WFS GPU IGN Géoplateforme
  for (const geomCol of ["geom", "the_geom"]) {
    try {
      const res = await wfsFetch({
        SERVICE: "WFS", VERSION: "2.0.0", REQUEST: "GetFeature",
        outputFormat: "application/json",
        typeName: "BDZONAGEPU.ZONE_URBA",
        count: "1",
        SRSNAME: "CRS:84",
        CQL_FILTER: `intersects(${geomCol},POINT(${lon} ${lat}))`,
      });
      if (res.ok) {
        const data = await res.json();
        if (data.features?.length) {
          const p = data.features[0].properties as Record<string, unknown>;
          return {
            libelle: (p.libelle ?? p.typezone ?? "—") as string,
            description: (p.libelong ?? p.libellezonage ?? "Zone non renseignée") as string,
            partition: (p.partition ?? "") as string,
            nomfic: (p.nomfic ?? "") as string,
            gpuDocId: (p.gpu_doc_id ?? "") as string,
          };
        }
      }
    } catch { /* essai suivant */ }
  }

  return null;
}

// ─── Schematic SVG (step 3) ─────────────────────────────────────────────────

const SVG_W = 600, SVG_H = 460;
const LABEL_MARGIN = 52; // espace pour les cotes autour de la parcelle
const PARCEL_AREA = { x: LABEL_MARGIN, y: LABEL_MARGIN, w: SVG_W - LABEL_MARGIN * 2, h: SVG_H - LABEL_MARGIN * 2 };

// Projette les coordonnées lon/lat en mètres locaux (origine = coin SW)
function projectToMeters(coords: [number, number][]): [number, number][] {
  const lons = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  const minLon = Math.min(...lons), minLat = Math.min(...lats);
  const avgLat = (minLat + Math.max(...lats)) / 2;
  return coords.map(([lon, lat]) => [
    geoDistM(avgLat, minLon, avgLat, lon),
    geoDistM(minLat, lon, lat, lon),
  ]);
}

function lineIntersect(
  p1: [number, number], p2: [number, number],
  p3: [number, number], p4: [number, number]
): [number, number] | null {
  const [x1, y1] = p1, [x2, y2] = p2, [x3, y3] = p3, [x4, y4] = p4;
  const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(d) < 1e-10) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}

// Inset d'un polygone par décalage de chaque arête vers l'intérieur.
// rvPx=sud (voie), rlPx=est/ouest (latéraux), rfPx=nord (fond).
// L'arête "sud" est celle dont la normale extérieure pointe vers le bas (SVG y-down).
function insetPolygon(
  pts: [number, number][],
  rvPx: number,
  rlPx = rvPx,
  rfPx = rvPx
): [number, number][] {
  const mn = Math.min(rvPx, rlPx, rfPx);
  if (mn <= 0 && rvPx <= 0 && rlPx <= 0 && rfPx <= 0) return pts;
  const n = pts.length;
  // Signe du sens du tracé (SVG, y vers le bas) : CW → area > 0
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n];
    area += x1 * y2 - x2 * y1;
  }
  const s = area > 0 ? 1 : -1;
  // Décale chaque arête vers l'intérieur
  const off: [[number, number], [number, number]][] = pts.map(([x1, y1], i) => {
    const [x2, y2] = pts[(i + 1) % n];
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-10) return [[x1, y1], [x2, y2]];
    // Normale intérieure
    const inx = s * (-dy / len), iny = s * (dx / len);
    // Normale extérieure → détermine le type de retrait
    const outy = -iny;
    const d = outy > 0.4 ? rvPx : outy < -0.4 ? rfPx : rlPx;
    return [[x1 + inx * d, y1 + iny * d], [x2 + inx * d, y2 + iny * d]];
  });
  // Intersections des arêtes adjacentes → nouveaux sommets
  return pts.map((_, i) => {
    const e1 = off[(i - 1 + n) % n];
    const e2 = off[i];
    return lineIntersect(e1[0], e1[1], e2[0], e2[1])
      ?? [(e1[1][0] + e2[0][0]) / 2, (e1[1][1] + e2[0][1]) / 2];
  });
}

function pointsToPath(pts: [number, number][]): string {
  return pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join("") + "Z";
}

function SchematicSVG({
  parcel, rules, analysis, addrLon, addrLat,
}: {
  parcel: ParcelData;
  rules: Rules;
  analysis?: AiAnalysis | null;
  addrLon?: number | null;
  addrLat?: number | null;
}) {
  const rv = parseFloat(rules.retraitVoie) || 0;
  const rl = parseFloat(rules.retraitLateral) || 0;
  const rf = parseFloat(rules.retraitFond) || 0;
  const emp = parseFloat(rules.empriseMax) || 0;
  const empPct = emp > 0 && emp <= 1 ? emp * 100 : emp;
  const empriseM2 = Math.round((parcel.surface * empPct) / 100);
  const espacesLibresPct = analysis?.espacesLibresPct ?? 0;
  const nPlaces = analysis?.parkingNombrePlaces ?? 0;

  const hasShape = parcel.coordinates && parcel.coordinates.length > 3;

  // ── Stats (identiques dans les deux modes) ──────────────────────────
  const widthRatio = Math.max(0, 1 - (2 * rl) / Math.max(parcel.largeur, 1));
  const depthRatio = Math.max(0, 1 - (rv + rf) / Math.max(parcel.profondeur, 1));
  const zoneNetteM2 = Math.max(0, Math.round(parcel.surface * widthRatio * depthRatio));

  const statsBlock = (
    <>
      <div className="grid grid-cols-3 gap-4 mt-6">
        {[
          { label: "Zone constructible nette", value: `${zoneNetteM2} m²` },
          { label: "Emprise max autorisée", value: emp ? `${empriseM2} m²` : "—" },
          { label: "Hauteur maximale", value: rules.hauteurMax ? `${rules.hauteurMax} m` : "—" },
        ].map((s) => (
          <div key={s.label} className="bg-warm-gray/40 border border-warm-gray p-4 rounded-sm text-center">
            <p className="text-2xl font-semibold text-anthracite">{s.value}</p>
            <p className="text-[11px] text-muted mt-1 leading-tight">{s.label}</p>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-muted mt-4 leading-relaxed">
        Estimation indicative à titre informatif uniquement. Seule une étude réglementaire complète par un professionnel permet de valider la constructibilité réelle d&apos;une parcelle.
      </p>
    </>
  );

  // ── Mode forme réelle (coordonnées cadastrales disponibles) ──────────
  if (hasShape) {
    // Les WFS retournent des anneaux fermés (dernier point = premier) — on supprime le doublon
    const mCoordsRaw = projectToMeters(parcel.coordinates);
    const mCoords: [number, number][] = (() => {
      if (mCoordsRaw.length > 1) {
        const [fx, fy] = mCoordsRaw[0];
        const [lx, ly] = mCoordsRaw[mCoordsRaw.length - 1];
        if (Math.abs(fx - lx) < 0.05 && Math.abs(fy - ly) < 0.05) return mCoordsRaw.slice(0, -1);
      }
      return mCoordsRaw;
    })();
    const maxMx = Math.max(...mCoords.map((c) => c[0]));
    const maxMy = Math.max(...mCoords.map((c) => c[1]));

    const scale = Math.min(
      (PARCEL_AREA.w - 16) / Math.max(maxMx, 1),
      (PARCEL_AREA.h - 80) / Math.max(maxMy, 1)
    );
    const shapeW = maxMx * scale, shapeH = maxMy * scale;
    const offX = PARCEL_AREA.x + (PARCEL_AREA.w - shapeW) / 2;
    const offY = PARCEL_AREA.y + 24;

    const toSvg = ([mx, my]: [number, number]): [number, number] => [
      offX + mx * scale,
      offY + shapeH - my * scale,
    ];

    const svgPts = mCoords.map(toSvg);
    const n = svgPts.length;
    const parcelPath = pointsToPath(svgPts);

    const cx = svgPts.reduce((s, p) => s + p[0], 0) / n;
    const cy = svgPts.reduce((s, p) => s + p[1], 0) / n;

    // Signe du tracé (SVG y-down : CW → area > 0)
    let areaSgn = 0;
    for (let i = 0; i < n; i++) {
      const [x1, y1] = svgPts[i], [x2, y2] = svgPts[(i + 1) % n];
      areaSgn += x1 * y2 - x2 * y1;
    }
    const s = areaSgn > 0 ? 1 : -1;

    // ── Trouver l'arête côté voie ────────────────────────────────────
    // Si on connaît les coords de l'adresse, on cherche l'arête dont la
    // normale extérieure pointe le plus vers le point d'adresse.
    let roadEdgeIdx = 0;
    const edgeOutNormals: [number, number][] = svgPts.map(([x1, y1], i) => {
      const [x2, y2] = svgPts[(i + 1) % n];
      const dx = x2 - x1, dy = y2 - y1;
      const el = Math.sqrt(dx * dx + dy * dy);
      if (el < 1e-10) return [0, 0];
      return [-(s * (-dy / el)), -(s * (dx / el))]; // outward normal
    });

    if (addrLon != null && addrLat != null) {
      const lons = parcel.coordinates.map((c) => c[0]);
      const lats = parcel.coordinates.map((c) => c[1]);
      const minLon0 = Math.min(...lons), minLat0 = Math.min(...lats);
      const avgLat0 = (minLat0 + Math.max(...lats)) / 2;
      const addrMx = geoDistM(avgLat0, minLon0, avgLat0, addrLon);
      const addrMy = geoDistM(minLat0, addrLon, addrLat, addrLon);
      const [asx, asy] = toSvg([addrMx, addrMy]);
      const toDx = asx - cx, toDy = asy - cy;
      const toLen = Math.sqrt(toDx * toDx + toDy * toDy);
      if (toLen > 1) {
        const tdx = toDx / toLen, tdy = toDy / toLen;
        let bestDot = -Infinity;
        edgeOutNormals.forEach(([onx, ony], i) => {
          const dot = onx * tdx + ony * tdy;
          if (dot > bestDot) { bestDot = dot; roadEdgeIdx = i; }
        });
      }
    } else {
      // Fallback : arête dont la normale extérieure pointe le plus vers le bas
      let bestOuty = -Infinity;
      edgeOutNormals.forEach(([, ony], i) => {
        if (ony > bestOuty) { bestOuty = ony; roadEdgeIdx = i; }
      });
    }

    const [re1x, re1y] = svgPts[roadEdgeIdx];
    const [re2x, re2y] = svgPts[(roadEdgeIdx + 1) % n];
    const reEdgeLen = Math.sqrt((re2x - re1x) ** 2 + (re2y - re1y) ** 2);
    const reDx = (re2x - re1x) / reEdgeLen, reDy = (re2y - re1y) / reEdgeLen;
    const inxR = s * (-reDy), inyR = s * reDx; // inward (into parcel)
    const outNx = -inxR, outNy = -inyR;          // outward (toward road)

    // ── Voie : parallelogramme suivant l'arête ───────────────────────
    const ROAD_W = 42;
    const EXT = 900;
    const rp1x = re1x - reDx * EXT, rp1y = re1y - reDy * EXT;
    const rp2x = re2x + reDx * EXT, rp2y = re2y + reDy * EXT;
    const roadPolygon = [
      [rp1x, rp1y], [rp2x, rp2y],
      [rp2x + outNx * ROAD_W, rp2y + outNy * ROAD_W],
      [rp1x + outNx * ROAD_W, rp1y + outNy * ROAD_W],
    ];
    const roadSvgPath = roadPolygon.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join("") + "Z";
    const roadLabelX = (re1x + re2x) / 2 + outNx * ROAD_W / 4;
    const roadLabelY = (re1y + re2y) / 2 + outNy * ROAD_W / 4;
    // Angle du texte de la voie (suit l'arête)
    const roadTextAngle = Math.atan2(reDy, reDx) * 180 / Math.PI;
    const roadTextAngleFinal = Math.abs(roadTextAngle) > 90 ? roadTextAngle + 180 : roadTextAngle;

    // ── Inset avec setbacks directionnels selon l'arête voie ─────────
    const rvPx = rv * scale, rlPx = rl * scale, rfPx = rf * scale;
    // Arête de fond = celle dont la normale est la plus opposée à la normale voie
    const [roadOnx, roadOny] = edgeOutNormals[roadEdgeIdx];
    let oppEdgeIdx = (roadEdgeIdx + Math.floor(n / 2)) % n;
    let bestOppDot = 1;
    edgeOutNormals.forEach(([onx, ony], i) => {
      if (i === roadEdgeIdx) return;
      const dot = onx * roadOnx + ony * roadOny;
      if (dot < bestOppDot) { bestOppDot = dot; oppEdgeIdx = i; }
    });
    const hasInset = rvPx > 1 || rlPx > 1 || rfPx > 1;
    const offEdges: [[number, number], [number, number]][] = svgPts.map(([x1, y1], i) => {
      const [x2, y2] = svgPts[(i + 1) % n];
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1e-10) return [[x1, y1], [x2, y2]];
      const inx2 = s * (-dy / len), iny2 = s * (dx / len);
      const d = i === roadEdgeIdx ? rvPx : i === oppEdgeIdx ? rfPx : rlPx;
      return [[x1 + inx2 * d, y1 + iny2 * d], [x2 + inx2 * d, y2 + iny2 * d]];
    });
    const insetPts: [number, number][] = svgPts.map((_, i) => {
      const e1 = offEdges[(i - 1 + n) % n];
      const e2 = offEdges[i];
      return lineIntersect(e1[0], e1[1], e2[0], e2[1])
        ?? [(e1[1][0] + e2[0][0]) / 2, (e1[1][1] + e2[0][1]) / 2];
    });
    const insetPath = pointsToPath(insetPts);

    // Cotes sur chaque côté
    const edgeLengths = mCoords.map((p, i) => {
      const next = mCoords[(i + 1) % mCoords.length];
      return Math.sqrt((next[0] - p[0]) ** 2 + (next[1] - p[1]) ** 2);
    });

    // ── Parking aligné sur l'arête voie ──────────────────────────────
    const nNonClose = analysis?.parkingNonClose ?? 0;
    const placeW = 2.5 * scale, placeD = 5 * scale;
    const parkTotalW = nPlaces * placeW;
    // Ancre : extrémité re2 de l'arête voie, recul vers l'intérieur de rvPx
    const pkAx = re2x + inxR * 0, pkAy = re2y + inyR * 0; // touching road edge at re2
    // Coins du parking (parallélogramme dans la parcelle)
    const pk1: [number, number] = [pkAx, pkAy];
    const pk2: [number, number] = [pkAx - reDx * parkTotalW, pkAy - reDy * parkTotalW];
    const pk3: [number, number] = [pk2[0] + inxR * placeD, pk2[1] + inyR * placeD];
    const pk4: [number, number] = [pk1[0] + inxR * placeD, pk1[1] + inyR * placeD];
    const showParking = nPlaces > 0 && parkTotalW < reEdgeLen * 0.9;

    // ── Emprise vs espaces libres ─────────────────────────────────────
    const insetAreaSvg = Math.abs(insetPts.reduce((acc, p, i) => {
      const n2 = insetPts[(i + 1) % insetPts.length];
      return acc + p[0] * n2[1] - n2[0] * p[1];
    }, 0) / 2);
    const insetAreaM2 = Math.round(insetAreaSvg / (scale * scale));
    const greenRequired = espacesLibresPct > 0 ? Math.round(parcel.surface * espacesLibresPct / 100) : 0;
    const maxBuildableM2 = parcel.surface - greenRequired;
    const empriseOk = espacesLibresPct === 0 || insetAreaM2 <= maxBuildableM2;

    const arrowX = SVG_W - 18, arrowY = 18;

    return (
      <>
        <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="w-full rounded-sm border border-warm-gray bg-[#f8f5f0]">
          <defs>
            <clipPath id="svgClip"><rect x={0} y={0} width={SVG_W} height={SVG_H} /></clipPath>
          </defs>
          <rect x={0} y={0} width={SVG_W} height={SVG_H} fill="#f8f5f0" />

          {/* Voie — suit l'orientation réelle de l'arête */}
          <g clipPath="url(#svgClip)">
            <path d={roadSvgPath} fill="#c8c4be" />
            <path d={roadSvgPath} fill="none" stroke="#999" strokeWidth={1.5} />
            {/* hachures parallèles à l'arête */}
            {Array.from({ length: 18 }, (_, k) => {
              const t = (k - 4) * 52;
              const hx1 = re1x + reDx * t, hy1 = re1y + reDy * t;
              return (
                <line key={k}
                  x1={hx1} y1={hy1}
                  x2={hx1 + outNx * ROAD_W} y2={hy1 + outNy * ROAD_W}
                  stroke="#aaa" strokeWidth={1} opacity={0.5} clipPath="url(#svgClip)" />
              );
            })}
            <text x={roadLabelX} y={roadLabelY} textAnchor="middle" dominantBaseline="middle"
              fontSize={10} fill="#444" fontFamily="sans-serif"
              stroke="white" strokeWidth="5" paintOrder="stroke"
              transform={`rotate(${roadTextAngleFinal},${roadLabelX},${roadLabelY})`}>
              {parcel.voie || "Voie"}
            </text>
          </g>

          {/* Zone de retrait */}
          {hasInset && (
            <path d={`${parcelPath} ${insetPath}`} fill="#e67e22" fillOpacity={0.18} fillRule="evenodd" />
          )}

          {/* Zone constructible */}
          {hasInset && <path d={insetPath} fill="#7a9478" fillOpacity={0.22} />}

          {/* Contour parcelle */}
          <path d={parcelPath} fill={hasInset ? "none" : "#ede8df"} stroke="#5a5247" strokeWidth={2} />

          {/* Cotes de retrait par rapport aux limites parcellaires */}
          {hasInset && svgPts.map(([x1, y1], i) => {
            const [x2, y2] = svgPts[(i + 1) % n];
            const edgePxLen = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
            if (edgePxLen < 40) return null;
            const setbackM = i === roadEdgeIdx ? rv : i === oppEdgeIdx ? rf : rl;
            if (setbackM <= 0) return null;
            const dx = x2 - x1, dy = y2 - y1;
            const len = Math.sqrt(dx * dx + dy * dy);
            const inx = s * (-dy / len), iny = s * (dx / len);
            const setbackPx = setbackM * scale;
            const pmx = (x1 + x2) / 2, pmy = (y1 + y2) / 2;
            const imx = pmx + inx * setbackPx, imy = pmy + iny * setbackPx;
            const dmx = (pmx + imx) / 2, dmy = (pmy + imy) / 2;
            const edx = dx / len, edy = dy / len;
            return (
              <g key={`ret-${i}`}>
                <line x1={pmx} y1={pmy} x2={imx} y2={imy} stroke="#c0621a" strokeWidth={1} opacity={0.75} />
                <line x1={pmx - edx * 3} y1={pmy - edy * 3} x2={pmx + edx * 3} y2={pmy + edy * 3} stroke="#c0621a" strokeWidth={1.2} opacity={0.75} />
                <line x1={imx - edx * 3} y1={imy - edy * 3} x2={imx + edx * 3} y2={imy + edy * 3} stroke="#c0621a" strokeWidth={1.2} opacity={0.75} />
                <text x={dmx} y={dmy} textAnchor="middle" dominantBaseline="middle"
                  fontSize={8.5} fill="#7a3d0a" fontFamily="sans-serif" fontWeight="600"
                  stroke="white" strokeWidth="4" paintOrder="stroke">
                  {setbackM} m
                </text>
              </g>
            );
          })}

          {/* Parking aligné sur la voie */}
          {showParking && (
            <g>
              {Array.from({ length: nPlaces }, (_, k) => {
                const isOpen = k < nNonClose;
                const cornerA: [number, number] = [
                  pk1[0] - reDx * k * placeW,
                  pk1[1] - reDy * k * placeW,
                ];
                const cornerB: [number, number] = [
                  cornerA[0] - reDx * placeW,
                  cornerA[1] - reDy * placeW,
                ];
                const cornerC: [number, number] = [cornerB[0] + inxR * placeD, cornerB[1] + inyR * placeD];
                const cornerD: [number, number] = [cornerA[0] + inxR * placeD, cornerA[1] + inyR * placeD];
                const cellPath = pointsToPath([cornerA, cornerB, cornerC, cornerD]);
                const midX = (cornerA[0] + cornerC[0]) / 2;
                const midY = (cornerA[1] + cornerC[1]) / 2;
                return (
                  <g key={k}>
                    <path d={cellPath}
                      fill={isOpen ? "white" : "#94a3b8"}
                      fillOpacity={isOpen ? 0.9 : 0.45}
                      stroke="#475569"
                      strokeWidth={isOpen ? 1.5 : 1}
                      strokeDasharray={isOpen ? "4 2" : "none"} />
                    <text x={midX} y={midY} textAnchor="middle" dominantBaseline="middle"
                      fontSize={8} fill="#1e293b" fontFamily="sans-serif"
                      transform={`rotate(${roadTextAngleFinal},${midX},${midY})`}>
                      {isOpen ? "⬜" : "P"}
                    </text>
                  </g>
                );
              })}
              {/* Label total */}
              {(() => {
                const lx = (pk1[0] + pk2[0]) / 2 - inxR * 10;
                const ly = (pk1[1] + pk2[1]) / 2 - inyR * 10;
                return (
                  <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
                    fontSize={8} fill="#1e293b" fontFamily="sans-serif"
                    transform={`rotate(${roadTextAngleFinal},${lx},${ly})`}>
                    {nPlaces}P{nNonClose > 0 ? ` (${nNonClose} ouv.)` : ""}
                  </text>
                );
              })()}
            </g>
          )}

          {/* Cotes sur chaque côté (hors voirie et latérales — fusionnées ci-dessous) */}
          {svgPts.map(([x1, y1], i) => {
            const [x2, y2] = svgPts[(i + 1) % n];
            const len = edgeLengths[i];
            if (len < 1.5) return null;
            const [eonx, eony] = edgeOutNormals[i];
            const roadDot = eonx * outNx + eony * outNy;
            const latDot  = eonx * reDx  + eony * reDy;
            // Supprimer les arêtes voirie et latérales (toutes fusionnées en côtes uniques)
            if (roadDot > 0.65)             return null;
            if (Math.abs(latDot) > 0.65)    return null;
            // Supprimer les connecteurs entre deux segments du même côté (décrochés)
            const [ponx, pony] = edgeOutNormals[(i - 1 + n) % n];
            const [nonx, nony] = edgeOutNormals[(i + 1) % n];
            const prevRd = ponx * outNx + pony * outNy;
            const nextRd = nonx * outNx + nony * outNy;
            if (prevRd > 0.65 && nextRd > 0.65) return null;
            const prevLd = ponx * reDx + pony * reDy;
            const nextLd = nonx * reDx + nony * reDy;
            if ((prevLd > 0.65 && nextLd > 0.65) || (prevLd < -0.65 && nextLd < -0.65)) return null;
            const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
            const el = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
            if (el < 12) return null; // trop court en pixels pour annoter
            // Normale perpendiculaire à l'arête, orientée vers l'extérieur
            const pnx = -(y2 - y1) / el, pny = (x2 - x1) / el;
            const dot = (mx - cx) * pnx + (my - cy) * pny;
            const sign = dot >= 0 ? 1 : -1;
            const onx = pnx * sign, ony = pny * sign;
            // Vecteur unitaire le long de l'arête
            const edx = (x2 - x1) / el, edy = (y2 - y1) / el;
            const COTE = 26; // distance arête→ligne de cote (px)
            const lx = mx + onx * COTE, ly = my + ony * COTE;
            // Angle du texte (suit l'arête, toujours lisible)
            const ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
            const textAng = Math.abs(ang) > 90 ? ang + 180 : ang;
            return (
              <g key={i}>
                {/* Lignes d'extension depuis chaque sommet */}
                <line x1={x1 + onx * 3} y1={y1 + ony * 3} x2={x1 + onx * (COTE + 5)} y2={y1 + ony * (COTE + 5)} stroke="#999" strokeWidth={0.7} />
                <line x1={x2 + onx * 3} y1={y2 + ony * 3} x2={x2 + onx * (COTE + 5)} y2={y2 + ony * (COTE + 5)} stroke="#999" strokeWidth={0.7} />
                {/* Ligne de cote complète */}
                <line x1={x1 + onx * COTE} y1={y1 + ony * COTE} x2={x2 + onx * COTE} y2={y2 + ony * COTE} stroke="#999" strokeWidth={0.7} />
                {/* Tirets d'extrémité (obliques) */}
                <line x1={x1 + onx * COTE - edx * 4 - ony * 3} y1={y1 + ony * COTE - edy * 4 + onx * 3}
                      x2={x1 + onx * COTE + edx * 4 + ony * 3} y2={y1 + ony * COTE + edy * 4 - onx * 3} stroke="#888" strokeWidth={1} />
                <line x1={x2 + onx * COTE - edx * 4 - ony * 3} y1={y2 + ony * COTE - edy * 4 + onx * 3}
                      x2={x2 + onx * COTE + edx * 4 + ony * 3} y2={y2 + ony * COTE + edy * 4 - onx * 3} stroke="#888" strokeWidth={1} />
                {/* Texte rotatif avec halo blanc qui masque la ligne de cote */}
                <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
                  fontSize={9} fill="#444" fontFamily="sans-serif" fontWeight="500"
                  stroke="white" strokeWidth="5" paintOrder="stroke"
                  transform={`rotate(${textAng.toFixed(1)},${lx.toFixed(1)},${ly.toFixed(1)})`}>
                  {Math.round(len)} m
                </text>
              </g>
            );
          })}

          {/* Côte unique façade sur voirie (fusion de toutes les arêtes voirie) */}
          {(() => {
            const COTE = 26;
            const rfIdxs: number[] = [];
            for (let i = 0; i < n; i++) {
              const [eonx, eony] = edgeOutNormals[i];
              if (eonx * outNx + eony * outNy > 0.65) rfIdxs.push(i);
            }
            if (rfIdxs.length === 0) return null;
            const totalLen = rfIdxs.reduce((sum, i) => sum + edgeLengths[i], 0);
            if (totalLen < 1.5) return null;
            const rfFirst = rfIdxs[0];
            const rfLast = rfIdxs[rfIdxs.length - 1];
            const [rx1, ry1] = svgPts[rfFirst];
            const [rx2, ry2] = svgPts[(rfLast + 1) % n];
            const rSpanDx = rx2 - rx1, rSpanDy = ry2 - ry1;
            const rSpanLen = Math.sqrt(rSpanDx * rSpanDx + rSpanDy * rSpanDy);
            if (rSpanLen < 1) return null;
            const edx = rSpanDx / rSpanLen, edy = rSpanDy / rSpanLen;
            const lx1 = rx1 + outNx * COTE, ly1 = ry1 + outNy * COTE;
            const lx2 = rx2 + outNx * COTE, ly2 = ry2 + outNy * COTE;
            const midX = (lx1 + lx2) / 2, midY = (ly1 + ly2) / 2;
            const ang = Math.atan2(rSpanDy, rSpanDx) * 180 / Math.PI;
            const textAng = Math.abs(ang) > 90 ? ang + 180 : ang;
            return (
              <g key="road-cote">
                <line x1={rx1 + outNx * 3} y1={ry1 + outNy * 3} x2={rx1 + outNx * (COTE + 5)} y2={ry1 + outNy * (COTE + 5)} stroke="#999" strokeWidth={0.7} />
                <line x1={rx2 + outNx * 3} y1={ry2 + outNy * 3} x2={rx2 + outNx * (COTE + 5)} y2={ry2 + outNy * (COTE + 5)} stroke="#999" strokeWidth={0.7} />
                <line x1={lx1} y1={ly1} x2={lx2} y2={ly2} stroke="#999" strokeWidth={0.7} />
                <line x1={lx1 - edx * 4 - outNy * 3} y1={ly1 - edy * 4 + outNx * 3}
                      x2={lx1 + edx * 4 + outNy * 3} y2={ly1 + edy * 4 - outNx * 3} stroke="#888" strokeWidth={1} />
                <line x1={lx2 - edx * 4 - outNy * 3} y1={ly2 - edy * 4 + outNx * 3}
                      x2={lx2 + edx * 4 + outNy * 3} y2={ly2 + edy * 4 - outNx * 3} stroke="#888" strokeWidth={1} />
                <text x={midX} y={midY} textAnchor="middle" dominantBaseline="middle"
                  fontSize={9} fill="#444" fontFamily="sans-serif" fontWeight="500"
                  stroke="white" strokeWidth="5" paintOrder="stroke"
                  transform={`rotate(${textAng.toFixed(1)},${midX.toFixed(1)},${midY.toFixed(1)})`}>
                  {Math.round(totalLen)} m
                </text>
              </g>
            );
          })()}

          {/* Côtes latérales fusionnées (une par côté) */}
          {([1, -1] as const).map((side) => (() => {
            const COTE = 26;
            const latIdxs: number[] = [];
            for (let i = 0; i < n; i++) {
              const [eonx, eony] = edgeOutNormals[i];
              const ld = eonx * reDx + eony * reDy;
              if (side === 1 ? ld > 0.65 : ld < -0.65) latIdxs.push(i);
            }
            if (latIdxs.length === 0) return null;
            const totalLen = latIdxs.reduce((sum, i) => sum + edgeLengths[i], 0);
            if (totalLen < 1.5) return null;
            const rfFirst = latIdxs[0];
            const rfLast  = latIdxs[latIdxs.length - 1];
            const [rx1, ry1] = svgPts[rfFirst];
            const [rx2, ry2] = svgPts[(rfLast + 1) % n];
            const rSpanDx = rx2 - rx1, rSpanDy = ry2 - ry1;
            const rSpanLen = Math.sqrt(rSpanDx * rSpanDx + rSpanDy * rSpanDy);
            if (rSpanLen < 1) return null;
            const edx = rSpanDx / rSpanLen, edy = rSpanDy / rSpanLen;
            const pnx = -(rSpanDy / rSpanLen), pny = rSpanDx / rSpanLen;
            const mx = (rx1 + rx2) / 2, my = (ry1 + ry2) / 2;
            const dot = (mx - cx) * pnx + (my - cy) * pny;
            const sg = dot >= 0 ? 1 : -1;
            const onx = pnx * sg, ony = pny * sg;
            const lx1 = rx1 + onx * COTE, ly1 = ry1 + ony * COTE;
            const lx2 = rx2 + onx * COTE, ly2 = ry2 + ony * COTE;
            const midX = (lx1 + lx2) / 2, midY = (ly1 + ly2) / 2;
            const ang = Math.atan2(rSpanDy, rSpanDx) * 180 / Math.PI;
            const textAng = Math.abs(ang) > 90 ? ang + 180 : ang;
            return (
              <g key={`lat-cote-${side}`}>
                <line x1={rx1 + onx * 3} y1={ry1 + ony * 3} x2={rx1 + onx * (COTE + 5)} y2={ry1 + ony * (COTE + 5)} stroke="#999" strokeWidth={0.7} />
                <line x1={rx2 + onx * 3} y1={ry2 + ony * 3} x2={rx2 + onx * (COTE + 5)} y2={ry2 + ony * (COTE + 5)} stroke="#999" strokeWidth={0.7} />
                <line x1={lx1} y1={ly1} x2={lx2} y2={ly2} stroke="#999" strokeWidth={0.7} />
                <line x1={lx1 - edx * 4 - ony * 3} y1={ly1 - edy * 4 + onx * 3}
                      x2={lx1 + edx * 4 + ony * 3} y2={ly1 + edy * 4 - onx * 3} stroke="#888" strokeWidth={1} />
                <line x1={lx2 - edx * 4 - ony * 3} y1={ly2 - edy * 4 + onx * 3}
                      x2={lx2 + edx * 4 + ony * 3} y2={ly2 + edy * 4 - onx * 3} stroke="#888" strokeWidth={1} />
                <text x={midX} y={midY} textAnchor="middle" dominantBaseline="middle"
                  fontSize={9} fill="#444" fontFamily="sans-serif" fontWeight="500"
                  stroke="white" strokeWidth="5" paintOrder="stroke"
                  transform={`rotate(${textAng.toFixed(1)},${midX.toFixed(1)},${midY.toFixed(1)})`}>
                  {Math.round(totalLen)} m
                </text>
              </g>
            );
          })())}

          {hasInset && (
            <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
              fontSize={10} fill="#3a6b40" fontFamily="sans-serif">Zone constructible</text>
          )}

          {/* Annexe en limite séparative — collée à la limite latérale, retrait 5 m voirie */}
          {(analysis?.annexesEnLimite ?? []).length > 0 && (() => {
            const annexes = analysis!.annexesEnLimite!;
            const maxEmprise = Math.max(...annexes.map((a) => a.empriseMaxM2));
            const roadOffPx = 5 * scale;
            // Vecteur perpendiculaire à la voirie (utilisé comme repli si la limite latérale est dégénérée)
            const perpX = reDy, perpY = -reDx;
            const toC = perpX * (cx - re1x) + perpY * (cy - re1y);
            // Remonter depuis re1 le long des segments parallèles à la voirie pour trouver
            // le vrai coin voirie↔limite-latérale (gère les décrochés multi-segments)
            let cornerIdx = roadEdgeIdx;
            let lateralFarX = cx, lateralFarY = cy; // repli : direction vers centroïde
            for (let step = 0; step < n - 1; step++) {
              const prevIdx = (cornerIdx - 1 + n) % n;
              const [px, py] = svgPts[prevIdx], [qx, qy] = svgPts[cornerIdx];
              const pdx = qx - px, pdy = qy - py, plen = Math.sqrt(pdx * pdx + pdy * pdy);
              if (plen < 1e-10) { cornerIdx = prevIdx; continue; }
              const parallelDot = Math.abs((pdx / plen) * reDx + (pdy / plen) * reDy);
              const prevOutDot = (-(s * (-pdy / plen))) * outNx + (-(s * (pdx / plen))) * outNy;
              if (parallelDot < 0.7 || prevOutDot < 0.5) {
                // Arête svgPts[prevIdx]→svgPts[cornerIdx] = vraie limite latérale
                lateralFarX = px; lateralFarY = py;
                break;
              }
              cornerIdx = prevIdx;
            }
            const [anchorX, anchorY] = svgPts[cornerIdx];
            // Direction latérale = direction réelle de l'arête limite latérale (pas seulement la perp.)
            const latDx = lateralFarX - anchorX, latDy = lateralFarY - anchorY;
            const latLen = Math.sqrt(latDx * latDx + latDy * latDy);
            const altUx = latLen > 1 ? latDx / latLen : (toC > 0 ? perpX : -perpX);
            const altUy = latLen > 1 ? latDy / latLen : (toC > 0 ? perpY : -perpY);
            // Profondeur disponible depuis le vrai coin dans la direction latérale (ray-cast)
            let altLen = 0;
            for (let k = 0; k < n; k++) {
              const [ex, ey] = svgPts[k], [fx, fy] = svgPts[(k + 1) % n];
              const edx = fx - ex, edy = fy - ey;
              const denom = altUx * edy - altUy * edx;
              if (Math.abs(denom) < 1e-10) continue;
              const t = ((ex - anchorX) * edy - (ey - anchorY) * edx) / denom;
              const u = ((ex - anchorX) * altUy - (ey - anchorY) * altUx) / denom;
              if (t > 1e-4 && u >= -0.01 && u <= 1.01) altLen = Math.max(altLen, t);
            }
            if (altLen < roadOffPx + 5) return null;
            // Normale intérieure depuis la limite latérale (vers le centroïde)
            const perpAx = -altUy, perpAy = altUx;
            const perpBx =  altUy, perpBy = -altUx;
            const toCx = cx - anchorX, toCy = cy - anchorY;
            const useA = (perpAx * toCx + perpAy * toCy) > 0;
            const annexeInx = useA ? perpAx : perpBx;
            const annexeIny = useA ? perpAy : perpBy;
            // Rectangle : long côté collé à la limite latérale, face courte (4 m) dans la parcelle
            const annexeFaceM = 4.0;
            const maxLengthM = (altLen - roadOffPx) / scale * 0.9;
            const annexeLengthM = Math.min(maxEmprise / annexeFaceM, maxLengthM);
            if (annexeLengthM < 1) return null;
            const annexeFacePx = annexeFaceM * scale;
            const annexeLengthPx = annexeLengthM * scale;
            const aA: [number, number] = [anchorX + altUx * roadOffPx, anchorY + altUy * roadOffPx];
            const aB: [number, number] = [aA[0] + altUx * annexeLengthPx, aA[1] + altUy * annexeLengthPx];
            const aC: [number, number] = [aB[0] + annexeInx * annexeFacePx, aB[1] + annexeIny * annexeFacePx];
            const aD: [number, number] = [aA[0] + annexeInx * annexeFacePx, aA[1] + annexeIny * annexeFacePx];
            const annexePath = pointsToPath([aA, aB, aC, aD]);
            const midAx = (aA[0] + aC[0]) / 2, midAy = (aA[1] + aC[1]) / 2;
            const annexeAng = Math.atan2(altUy, altUx) * 180 / Math.PI;
            const annexeAngFinal = Math.abs(annexeAng) > 90 ? annexeAng + 180 : annexeAng;
            // Côtes annexe — décalage de 16 px en dehors des faces concernées
            const CA = 16;
            // Direction outward depuis la limite latérale (vers l'extérieur de la parcelle)
            const clAx = -annexeInx, clAy = -annexeIny;
            // Côte retrait 5 m (de l'arête voirie jusqu'au début de l'annexe)
            const c5_1x = anchorX + clAx * CA, c5_1y = anchorY + clAy * CA;
            const c5_2x = aA[0] + clAx * CA, c5_2y = aA[1] + clAy * CA;
            const c5MidX = (c5_1x + c5_2x) / 2, c5MidY = (c5_1y + c5_2y) / 2;
            // Longueur annexe : de aA→aB, décalée en dehors de la limite latérale (-annexeIn)
            const clA1x = aA[0] + clAx * CA, clA1y = aA[1] + clAy * CA;
            const clA2x = aB[0] + clAx * CA, clA2y = aB[1] + clAy * CA;
            const clMidX = (clA1x + clA2x) / 2, clMidY = (clA1y + clA2y) / 2;
            const clAng = Math.atan2(altUy, altUx) * 180 / Math.PI;
            const clAngF = Math.abs(clAng) > 90 ? clAng + 180 : clAng;
            // Face 3 m : de aB→aC (face extrême), décalée au-delà dans la direction altU
            const cfOx = altUx, cfOy = altUy;
            const cfB1x = aB[0] + cfOx * CA, cfB1y = aB[1] + cfOy * CA;
            const cfC1x = aC[0] + cfOx * CA, cfC1y = aC[1] + cfOy * CA;
            const cfMidX = (cfB1x + cfC1x) / 2, cfMidY = (cfB1y + cfC1y) / 2;
            const cfAng = Math.atan2(annexeIny, annexeInx) * 180 / Math.PI;
            const cfAngF = Math.abs(cfAng) > 90 ? cfAng + 180 : cfAng;
            return (
              <g key="annexe-limite">
                <path d={annexePath} fill="#6366f1" fillOpacity={0.25} stroke="#6366f1" strokeWidth={1.5} strokeDasharray="5 3" />
                <text x={midAx} y={midAy} textAnchor="middle" dominantBaseline="middle"
                  fontSize={8} fill="#3730a3" fontFamily="sans-serif" fontWeight="600"
                  stroke="white" strokeWidth="4" paintOrder="stroke"
                  transform={`rotate(${annexeAngFinal.toFixed(1)},${midAx.toFixed(1)},${midAy.toFixed(1)})`}>
                  Annexe {maxEmprise}m²
                </text>
                {/* Côte retrait voirie 5 m */}
                <line x1={anchorX + clAx * 2} y1={anchorY + clAy * 2} x2={anchorX + clAx * (CA + 4)} y2={anchorY + clAy * (CA + 4)} stroke="#6366f1" strokeWidth={0.6} />
                <line x1={aA[0] + clAx * 2} y1={aA[1] + clAy * 2} x2={aA[0] + clAx * (CA + 4)} y2={aA[1] + clAy * (CA + 4)} stroke="#6366f1" strokeWidth={0.6} />
                <line x1={c5_1x} y1={c5_1y} x2={c5_2x} y2={c5_2y} stroke="#6366f1" strokeWidth={0.7} />
                <line x1={c5_1x - altUx * 4 - clAy * 3} y1={c5_1y - altUy * 4 + clAx * 3}
                      x2={c5_1x + altUx * 4 + clAy * 3} y2={c5_1y + altUy * 4 - clAx * 3} stroke="#6366f1" strokeWidth={1} />
                <line x1={c5_2x - altUx * 4 - clAy * 3} y1={c5_2y - altUy * 4 + clAx * 3}
                      x2={c5_2x + altUx * 4 + clAy * 3} y2={c5_2y + altUy * 4 - clAx * 3} stroke="#6366f1" strokeWidth={1} />
                <text x={c5MidX} y={c5MidY} textAnchor="middle" dominantBaseline="middle"
                  fontSize={7.5} fill="#3730a3" fontFamily="sans-serif"
                  stroke="white" strokeWidth="4" paintOrder="stroke"
                  transform={`rotate(${clAngF.toFixed(1)},${c5MidX.toFixed(1)},${c5MidY.toFixed(1)})`}>
                  {Math.round(roadOffPx / scale)} m
                </text>
                {/* Côte longueur annexe (extension aA partagée avec la côte 5m ci-dessus) */}
                <line x1={aB[0] + clAx * 2} y1={aB[1] + clAy * 2} x2={aB[0] + clAx * (CA + 4)} y2={aB[1] + clAy * (CA + 4)} stroke="#6366f1" strokeWidth={0.6} />
                <line x1={clA1x} y1={clA1y} x2={clA2x} y2={clA2y} stroke="#6366f1" strokeWidth={0.7} />
                <line x1={clA1x - altUx * 4 - clAy * 3} y1={clA1y - altUy * 4 + clAx * 3}
                      x2={clA1x + altUx * 4 + clAy * 3} y2={clA1y + altUy * 4 - clAx * 3} stroke="#6366f1" strokeWidth={1} />
                <line x1={clA2x - altUx * 4 - clAy * 3} y1={clA2y - altUy * 4 + clAx * 3}
                      x2={clA2x + altUx * 4 + clAy * 3} y2={clA2y + altUy * 4 - clAx * 3} stroke="#6366f1" strokeWidth={1} />
                <text x={clMidX} y={clMidY} textAnchor="middle" dominantBaseline="middle"
                  fontSize={7.5} fill="#3730a3" fontFamily="sans-serif"
                  stroke="white" strokeWidth="4" paintOrder="stroke"
                  transform={`rotate(${clAngF.toFixed(1)},${clMidX.toFixed(1)},${clMidY.toFixed(1)})`}>
                  {Math.round(annexeLengthM)} m
                </text>
                {/* Côte face 3 m */}
                <line x1={aB[0] + cfOx * 2} y1={aB[1] + cfOy * 2} x2={aB[0] + cfOx * (CA + 4)} y2={aB[1] + cfOy * (CA + 4)} stroke="#6366f1" strokeWidth={0.6} />
                <line x1={aC[0] + cfOx * 2} y1={aC[1] + cfOy * 2} x2={aC[0] + cfOx * (CA + 4)} y2={aC[1] + cfOy * (CA + 4)} stroke="#6366f1" strokeWidth={0.6} />
                <line x1={cfB1x} y1={cfB1y} x2={cfC1x} y2={cfC1y} stroke="#6366f1" strokeWidth={0.7} />
                <line x1={cfB1x - annexeInx * 4 - cfOy * 3} y1={cfB1y - annexeIny * 4 + cfOx * 3}
                      x2={cfB1x + annexeInx * 4 + cfOy * 3} y2={cfB1y + annexeIny * 4 - cfOx * 3} stroke="#6366f1" strokeWidth={1} />
                <line x1={cfC1x - annexeInx * 4 - cfOy * 3} y1={cfC1y - annexeIny * 4 + cfOx * 3}
                      x2={cfC1x + annexeInx * 4 + cfOy * 3} y2={cfC1y + annexeIny * 4 - cfOx * 3} stroke="#6366f1" strokeWidth={1} />
                <text x={cfMidX} y={cfMidY} textAnchor="middle" dominantBaseline="middle"
                  fontSize={7.5} fill="#3730a3" fontFamily="sans-serif"
                  stroke="white" strokeWidth="4" paintOrder="stroke"
                  transform={`rotate(${cfAngF.toFixed(1)},${cfMidX.toFixed(1)},${cfMidY.toFixed(1)})`}>
                  {annexeFaceM} m
                </text>
              </g>
            );
          })()}

          {!empriseOk && (
            <g>
              <rect x={2} y={2} width={SVG_W - 4} height={18} rx={2} fill="#fbbf24" fillOpacity={0.85} />
              <text x={SVG_W / 2} y={11} textAnchor="middle" dominantBaseline="middle"
                fontSize={8.5} fill="#78350f" fontFamily="sans-serif" fontWeight="600">
                Zone retraits ({insetAreaM2} m²) &gt; surface constructible ({maxBuildableM2} m² après {espacesLibresPct}% espaces verts)
              </text>
            </g>
          )}

          <text x={12} y={SVG_H - 8} fontSize={8.5} fill="#aaa" fontFamily="sans-serif">
            {parcel.ref} · {parcel.surface} m²
          </text>

          <g>
            <line x1={arrowX} y1={arrowY + 10} x2={arrowX} y2={arrowY - 4} stroke="#666" strokeWidth={1.2} />
            <polygon points={`${arrowX},${arrowY - 8} ${arrowX - 3},${arrowY - 1} ${arrowX + 3},${arrowY - 1}`} fill="#666" />
            <text x={arrowX} y={arrowY + 16} textAnchor="middle" fontSize={8} fill="#666" fontFamily="sans-serif">N</text>
          </g>
        </svg>

        <div className="flex flex-wrap gap-4 mt-3 text-xs text-anthracite/70">
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm opacity-60 bg-[#e67e22]" />Zone de retrait</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm opacity-60 bg-[#7a9478]" />Zone constructible</span>
          {showParking && <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm opacity-60 bg-[#94a3b8]" />Stationnement</span>}
          <span className="text-[10px] text-muted">Nord en haut · Cadastre IGN · Voie détectée automatiquement</span>
        </div>

        {statsBlock}
      </>
    );
  }

  // ── Mode rectangulaire (fallback sans coordonnées) ───────────────────
  const ROAD_H = 44, NEIGHBOR_W = 72;
  const PLOT_X = NEIGHBOR_W, PLOT_Y = ROAD_H;
  const PLOT_W = SVG_W - NEIGHBOR_W, PLOT_H = SVG_H - ROAD_H;
  const scaleX = PLOT_W / Math.max(parcel.largeur, 1);
  const scaleY = PLOT_H / Math.max(parcel.profondeur, 1);
  const vPx = rv * scaleY, lPx = rl * scaleX, fPx = rf * scaleY;
  const bx = PLOT_X + lPx, by = PLOT_Y + vPx;
  const bw = PLOT_W - 2 * lPx, bh = PLOT_H - vPx - fPx;
  const empriseDepthM = parcel.largeur - 2 * rl > 0 ? empriseM2 / (parcel.largeur - 2 * rl) : 0;
  const empriseHpx = Math.min(bh, empriseDepthM * scaleY);

  return (
    <>
      <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="w-full rounded-sm border border-warm-gray bg-warm-white">
        <rect x={0} y={0} width={SVG_W} height={ROAD_H} fill="#ccc" />
        <line x1={0} y1={ROAD_H} x2={SVG_W} y2={ROAD_H} stroke="#999" strokeWidth={1} />
        <text x={SVG_W / 2} y={ROAD_H / 2 + 5} textAnchor="middle" fontSize={11} fill="#555" fontFamily="sans-serif">{parcel.voie}</text>
        <rect x={0} y={ROAD_H} width={NEIGHBOR_W} height={PLOT_H} fill="#d8d0c4" />
        <text x={NEIGHBOR_W / 2} y={ROAD_H + PLOT_H / 2} textAnchor="middle" fontSize={10} fill="#888" fontFamily="sans-serif" transform={`rotate(-90, ${NEIGHBOR_W / 2}, ${ROAD_H + PLOT_H / 2})`}>Voisin</text>
        <rect x={PLOT_X} y={PLOT_Y} width={PLOT_W} height={PLOT_H} fill="#ede8df" stroke="#bbb" strokeWidth={1} />
        {vPx > 0 && <rect x={PLOT_X} y={PLOT_Y} width={PLOT_W} height={vPx} fill="#e74c3c" fillOpacity={0.2} />}
        {lPx > 0 && bh > 0 && <>
          <rect x={PLOT_X} y={PLOT_Y + vPx} width={lPx} height={bh} fill="#e67e22" fillOpacity={0.22} />
          <rect x={PLOT_X + PLOT_W - lPx} y={PLOT_Y + vPx} width={lPx} height={bh} fill="#e67e22" fillOpacity={0.22} />
        </>}
        {fPx > 0 && <rect x={PLOT_X} y={PLOT_Y + PLOT_H - fPx} width={PLOT_W} height={fPx} fill="#e67e22" fillOpacity={0.22} />}
        {bw > 0 && bh > 0 && <rect x={bx} y={by} width={bw} height={bh} fill="#7a9478" fillOpacity={0.22} />}
        {empriseHpx > 0 && bw > 0 && <rect x={bx} y={by} width={bw} height={empriseHpx} fill="#3b82f6" fillOpacity={0.3} />}
        {rv > 0 && vPx > 10 && <text x={PLOT_X + PLOT_W / 2} y={PLOT_Y + vPx / 2 + 4} textAnchor="middle" fontSize={10} fill="#c0392b" fontFamily="sans-serif">{rv} m</text>}
        {rl > 0 && lPx > 8 && bh > 0 && <text x={PLOT_X + lPx / 2} y={PLOT_Y + vPx + bh / 2} textAnchor="middle" fontSize={10} fill="#d35400" fontFamily="sans-serif" transform={`rotate(-90, ${PLOT_X + lPx / 2}, ${PLOT_Y + vPx + bh / 2})`}>{rl} m</text>}
        {rf > 0 && fPx > 10 && <text x={PLOT_X + PLOT_W / 2} y={PLOT_Y + PLOT_H - fPx / 2 + 4} textAnchor="middle" fontSize={10} fill="#d35400" fontFamily="sans-serif">{rf} m</text>}
        {bw > 20 && bh > 20 && <text x={bx + bw / 2} y={by + bh / 2 + 4} textAnchor="middle" fontSize={10} fill="#3a6b40" fontFamily="sans-serif">Zone constructible</text>}
      </svg>
      <div className="flex flex-wrap gap-4 mt-3 text-xs text-anthracite/70">
        <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm opacity-60 bg-[#e74c3c]" />Retrait voie</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm opacity-60 bg-[#e67e22]" />Retraits latéral / fond</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm opacity-60 bg-terracotta" />Zone constructible</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm opacity-60 bg-blue-500" />Emprise max</span>
      </div>
      {statsBlock}
    </>
  );
}

// ─── Field helper ───────────────────────────────────────────────────────────

function Field({ label, unit, value, onChange, placeholder }: {
  label: string; unit?: string; value: string;
  onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[11px] font-medium tracking-[0.12em] uppercase text-muted mb-1.5">{label}</label>
      <div className="flex items-center border border-warm-gray bg-white focus-within:border-terracotta transition-colors">
        <input type="number" min={0} value={value} onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? "0"}
          className="flex-1 px-3 py-2.5 text-sm text-anthracite bg-transparent outline-none" />
        {unit && <span className="px-3 text-xs text-muted border-l border-warm-gray bg-warm-gray/30 py-2.5 select-none">{unit}</span>}
      </div>
    </div>
  );
}

// ─── Autocomplete ───────────────────────────────────────────────────────────

function AutocompleteInput<T extends { label: string }>({
  label, value, onChange, suggestions, onSelect, placeholder, showList, onFocus, onHideList,
}: {
  label: string; value: string; onChange: (v: string) => void;
  suggestions: T[]; onSelect: (s: T) => void;
  placeholder?: string; showList: boolean; onFocus: () => void; onHideList: () => void;
}) {
  const [activeIdx, setActiveIdx] = useState(-1);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showList || suggestions.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const idx = activeIdx >= 0 ? activeIdx : 0;
      if (suggestions[idx]) { onSelect(suggestions[idx]); setActiveIdx(-1); }
    } else if (e.key === "Escape") { onHideList(); }
  }

  return (
    <div className="relative">
      <label className="block text-[11px] font-medium tracking-[0.12em] uppercase text-muted mb-1.5">{label}</label>
      <input type="text" value={value}
        onChange={(e) => { setActiveIdx(-1); onChange(e.target.value); }}
        onFocus={onFocus}
        onBlur={() => setTimeout(onHideList, 150)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full border border-warm-gray bg-white px-3 py-3 text-sm text-anthracite outline-none focus:border-terracotta transition-colors"
      />
      {showList && suggestions.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-20 bg-white border border-warm-gray shadow-lg divide-y divide-warm-gray/60 max-h-56 overflow-y-auto">
          {suggestions.map((s, i) => (
            <li key={s.label}>
              <button type="button" onMouseDown={() => { onSelect(s); setActiveIdx(-1); }}
                className={`w-full text-left px-4 py-2.5 text-sm text-anthracite transition-colors ${i === activeIdx ? "bg-warm-gray/70" : "hover:bg-warm-gray/40"}`}>
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Helper géométrie ───────────────────────────────────────────────────────

// Distance minimale en mètres entre un polygone [lat,lon][] et un anneau [lon,lat][]
function minDistToRing(shapePoly: [number, number][], ring: [number, number][]): number {
  const kLat = 111320;
  let minDist = Infinity;
  for (const [sLat, sLon] of shapePoly) {
    const kLon = kLat * Math.cos(sLat * Math.PI / 180);
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
      const dx = (x2 - x1) * kLon, dy = (y2 - y1) * kLat;
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-10) continue;
      const t = Math.max(0, Math.min(1, ((sLon - x1) * kLon * dx + (sLat - y1) * kLat * dy) / len2));
      const px = x1 + t * (x2 - x1), py = y1 + t * (y2 - y1);
      const d = Math.sqrt(((sLon - px) * kLon) ** 2 + ((sLat - py) * kLat) ** 2);
      if (d < minDist) minDist = d;
    }
  }
  return minDist;
}

// Estime par grille (0.25 m) la surface d'intersection entre un polygone A [lat,lon] et une liste de polygones B [lat,lon]
function sampledIntersectionAreaM2(
  polyA: [number, number][],
  polysB: [number, number][][],
): number {
  if (polyA.length < 3 || polysB.length === 0) return 0;
  const lats = polyA.map(([lat]) => lat);
  const lons = polyA.map(([, lon]) => lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const kLat = 111320;
  const refLat = (minLat + maxLat) / 2;
  const kLon = kLat * Math.cos(refLat * Math.PI / 180);
  const W = (maxLon - minLon) * kLon;
  const H = (maxLat - minLat) * kLat;
  if (W < 0.01 || H < 0.01) return 0;
  const step = 0.25;
  const nx = Math.max(2, Math.ceil(W / step));
  const ny = Math.max(2, Math.ceil(H / step));
  const ringA = polyA.map(([lat, lon]) => [lon, lat] as [number, number]);
  const ringsB = polysB.map((p) => p.map(([lat, lon]) => [lon, lat] as [number, number]));
  let inside = 0, intersect = 0;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const lon = minLon + ((i + 0.5) / nx) * (maxLon - minLon);
      const lat = minLat + ((j + 0.5) / ny) * (maxLat - minLat);
      if (!pointInPolygon(lon, lat, ringA)) continue;
      inside++;
      for (const rb of ringsB) {
        if (pointInPolygon(lon, lat, rb)) { intersect++; break; }
      }
    }
  }
  if (inside === 0) return 0;
  return Math.round((intersect / inside) * W * H);
}

// Surface d'un étage supérieur (R+1/R+2) qui dépasse des bâtiments existants et des RDC dessinés
function calcUpperFloorUncoveredM2(
  sh: { id: string; polygon: [number, number][]; surfaceM2: number },
  existingBuildings: { polygon: [number, number][] }[],
  drawnShapes: { id: string; polygon: [number, number][]; niveaux?: string; nonEmprise?: boolean }[],
): number {
  const coverPolys = [
    ...existingBuildings.map((b) => b.polygon),
    ...drawnShapes
      .filter((o) => o.id !== sh.id && !o.nonEmprise && o.niveaux === "rdc")
      .map((o) => o.polygon),
  ];
  if (coverPolys.length === 0) return sh.surfaceM2;
  const coveredArea = sampledIntersectionAreaM2(sh.polygon, coverPolys);
  return Math.max(0, sh.surfaceM2 - coveredArea);
}

// Options de dimensions parking non clos
const PARKING_OPTIONS_1: { label: string; shortLabel: string; w: number; d: number } = { label: "3,5 × 5 m", shortLabel: "1 place", w: 3.5, d: 5 };
const PARKING_SIDE_BY_SIDE: { label: string; shortLabel: string; w: number; d: number } = { label: "5 × 5 m (côte à côte)", shortLabel: "2 places", w: 5, d: 5 };
const PARKING_TANDEM: { label: string; shortLabel: string; w: number; d: number } = { label: "3 × 10 m (en enfilade)", shortLabel: "2 enfilade", w: 3, d: 10 };

// Mesure la largeur disponible sur la limite de parcelle, perpendiculairement à la flèche d'accès
// parcelRing: [lon, lat][] (GeoJSON)
function measureAccessWidth(
  ap: { lat: number; lon: number; angleDeg: number },
  parcelRing: [number, number][],
): number {
  const kLat = 111320;
  const kLon = kLat * Math.cos((ap.lat * Math.PI) / 180);
  const rad = (ap.angleDeg * Math.PI) / 180;
  // Perpendiculaire droite/gauche
  const rightE = Math.cos(rad), rightN = -Math.sin(rad);
  const apX = ap.lon * kLon, apY = ap.lat * kLat;
  const ringM = parcelRing.map(([lon, lat]) => [lon * kLon, lat * kLat] as [number, number]);

  let totalWidth = 0;
  for (const sign of [1, -1] as const) {
    const nx = sign * rightE, ny = sign * rightN;
    let bestT = 60; // max 60 m
    for (let j = 0; j < ringM.length - 1; j++) {
      const [x1, y1] = ringM[j], [x2, y2] = ringM[j + 1];
      const sdx = x2 - x1, sdy = y2 - y1;
      const denom = nx * sdy - ny * sdx;
      if (Math.abs(denom) < 1e-10) continue;
      const tx = x1 - apX, ty = y1 - apY;
      const t = (tx * sdy - ty * sdx) / denom;
      const s = (tx * ny - ty * nx) / denom;
      if (t < 0.1 || t > 60 || s < 0 || s > 1) continue;
      if (t < bestT) bestT = t;
    }
    totalWidth += bestT;
  }
  return totalWidth;
}

// Génère un rectangle de parking orienté selon angleDeg, clippé aux limites de la parcelle
// parcelRing: [lon, lat][] — utilisé pour ne pas dépasser les limites latérales
function buildParkingPolygon(
  ap: { lat: number; lon: number; angleDeg: number },
  widthM: number,
  depthM: number,
  parcelRing: [number, number][] | null,
): [number, number][] { // retourne [lat, lon][]
  const kLat = 111320;
  const kLon = kLat * Math.cos((ap.lat * Math.PI) / 180);
  const apX = ap.lon * kLon, apY = ap.lat * kLat;

  // ── Fallback si pas de parcelle : orientation selon la flèche ──
  const rad = (ap.angleDeg * Math.PI) / 180;
  const fwdE = Math.sin(rad), fwdN = Math.cos(rad);
  let segE = Math.cos(rad), segN = -Math.sin(rad); // direction de la voie (perp. à la flèche)
  let inE = fwdE, inN = fwdN;                       // direction inward

  // Point projeté de l'accès sur la limite (base du rectangle)
  let baseX = apX, baseY = apY;
  let rightDist = widthM / 2, leftDist = widthM / 2;
  let depth = depthM;

  if (parcelRing) {
    const ringM = parcelRing.map(([lon, lat]) => [lon * kLon, lat * kLat] as [number, number]);
    const nSeg = ringM.length - 1;

    // ── 1. Segment de voie : le plus proche du point d'accès ──
    let bestDistSq = Infinity, bestJ = 0, bestT = 0;
    for (let j = 0; j < nSeg; j++) {
      const [x1, y1] = ringM[j], [x2, y2] = ringM[j + 1];
      const dx = x2 - x1, dy = y2 - y1;
      const lenSq = dx * dx + dy * dy;
      if (lenSq < 1) continue;
      const t = Math.max(0, Math.min(1, ((apX - x1) * dx + (apY - y1) * dy) / lenSq));
      const d2 = (x1 + t * dx - apX) ** 2 + (y1 + t * dy - apY) ** 2;
      if (d2 < bestDistSq) { bestDistSq = d2; bestJ = j; bestT = t; }
    }

    // ── 2. Direction du segment voie ──
    const [x1r, y1r] = ringM[bestJ], [x2r, y2r] = ringM[bestJ + 1];
    const dxR = x2r - x1r, dyR = y2r - y1r, lenR = Math.sqrt(dxR * dxR + dyR * dyR);
    segE = dxR / lenR; segN = dyR / lenR;

    // ── 3. Normale inward (vers le centroïde) ──
    const cx = ringM.reduce((s, [x]) => s + x, 0) / nSeg;
    const cy = ringM.reduce((s, [, y]) => s + y, 0) / nSeg;
    const n1E = -segN, n1N = segE;
    const dotC = (cx - apX) * n1E + (cy - apY) * n1N;
    inE = dotC >= 0 ? n1E : -n1E;
    inN = dotC >= 0 ? n1N : -n1N;

    // ── 4. Base = projection de l'accès sur le segment voie ──
    baseX = x1r + bestT * dxR;
    baseY = y1r + bestT * dyR;

    // ── 5. Coordonnées parking de tous les sommets ──
    // lat = position latérale (le long de la voie, + = droite)
    // dep = profondeur (dans la parcelle, + = intérieur)
    const pc = ringM.map(([vx, vy]) => ({
      lat: (vx - baseX) * segE + (vy - baseY) * segN,
      dep: (vx - baseX) * inE  + (vy - baseY) * inN,
    }));

    // ── 6. Profondeur : min projection > 0 parmi tous les sommets ──
    depth = depthM;
    for (const { dep } of pc) {
      if (dep > 0.5 && dep < depth) depth = dep;
    }
    depth = Math.max(1, depth - 0.3);

    // ── 7. Largeur initiale : étendue du segment voie depuis la base ──
    const distToEnd   = (1 - bestT) * lenR;
    const distToStart = bestT * lenR;
    rightDist = Math.min(widthM / 2, distToEnd);
    leftDist  = Math.min(widthM / 2, distToStart);

    // ── 8. Largeur affinée : contraintes latérales par les arêtes non-voie ──
    // Pour chaque arête non-voie, on trouve sa plage lat dans la profondeur [0, depth]
    // et on clippe rightDist / leftDist en conséquence.
    for (let j = 0; j < nSeg; j++) {
      if (j === bestJ) continue; // ignorer l'arête voie
      const a = pc[j], b = pc[(j + 1) % nSeg];
      const ddep = b.dep - a.dep, dlat = b.lat - a.lat;

      // Bornes de t dans l'intervalle dep ∈ [0, depth]
      let tMin = 0, tMax = 1;
      if (Math.abs(ddep) > 1e-6) {
        const t0 = (0 - a.dep) / ddep, t1 = (depth - a.dep) / ddep;
        tMin = Math.max(0, Math.min(t0, t1));
        tMax = Math.min(1, Math.max(t0, t1));
      } else {
        if (a.dep < 0 || a.dep > depth) continue;
      }
      if (tMin >= tMax) continue;

      const latA = a.lat + tMin * dlat, latB = a.lat + tMax * dlat;
      const latLo = Math.min(latA, latB), latHi = Math.max(latA, latB);

      // Côté droit : l'arête est entièrement à droite → elle borne rightDist
      if (latLo > 0) rightDist = Math.min(rightDist, latLo);
      // Côté gauche : l'arête est entièrement à gauche → elle borne leftDist
      if (latHi < 0) leftDist  = Math.min(leftDist, -latHi);
    }

    // Marge de sécurité 0.1 m des limites
    rightDist = Math.max(0, rightDist - 0.1);
    leftDist  = Math.max(0, leftDist  - 0.1);
  }

  // ── 7. Construction du rectangle ──
  // Origine = baseX/baseY (sur la limite de voirie)
  // Largeur le long du segment (segE/segN), profondeur vers l'intérieur (inE/inN)
  const b = [baseX, baseY] as [number, number];
  const toLat = (x: number, y: number): [number, number] => [y / kLat, x / kLon];
  const pts: [number, number][] = [
    toLat(b[0] - segE * leftDist,                       b[1] - segN * leftDist),
    toLat(b[0] + segE * rightDist,                      b[1] + segN * rightDist),
    toLat(b[0] + segE * rightDist + inE * depth,        b[1] + segN * rightDist + inN * depth),
    toLat(b[0] - segE * leftDist  + inE * depth,        b[1] - segN * leftDist  + inN * depth),
  ];
  return [...pts, pts[0]];
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function PluCalculator() {
  const [step, setStep] = useState<Step>(1);
  // Carte : centre sur la France au départ
  const [mapCenter, setMapCenter] = useState<[number, number]>([46.5, 2.0]);
  const [mapZoom, setMapZoom] = useState(6);

  // Recherche par adresse (centre la carte uniquement)
  const [address, setAddress] = useState("");
  const [addrSuggestions, setAddrSuggestions] = useState<Suggestion[]>([]);
  const [showAddrList, setShowAddrList] = useState(false);
  const addrDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Recherche par référence cadastrale
  const [commune, setCommune] = useState("");
  const [communeSuggestions, setCommuneSuggestions] = useState<CommuneSuggestion[]>([]);
  const [showCommuneList, setShowCommuneList] = useState(false);
  const [selectedCommune, setSelectedCommune] = useState<CommuneSuggestion | null>(null);
  const [section, setSection] = useState("");
  const [refNumero, setRefNumero] = useState("");
  const communeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Résultats
  const [loadingMap, setLoadingMap] = useState(false);
  const [parcel, setParcel] = useState<ParcelData | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<GeoFeature | null>(null);
  const [zone, setZone] = useState<ZoneInfo | null>(null);
  const [parcelError, setParcelError] = useState(false);
  const [pluWarning, setPluWarning] = useState(false);

  // Lotissement
  const [isLotissement, setIsLotissement] = useState(false);
  const [addrLon, setAddrLon] = useState<number | null>(null);
  const [addrLat, setAddrLat] = useState<number | null>(null);
  const [lotSurface, setLotSurface] = useState("");
  const [lotPlanFile, setLotPlanFile] = useState<File | null>(null);
  const [analyzingLotPlan, setAnalyzingLotPlan] = useState(false);
  const [lotPlanError, setLotPlanError] = useState<string | null>(null);
  const [lotPolygons, setLotPolygons] = useState<LotPolygon[]>([]);
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);
  const [lotAnchored, setLotAnchored] = useState<boolean | null>(null);
  const [lotNoPolygon, setLotNoPolygon] = useState(false);
  const [cpapFile, setCpapFile] = useState<File | null>(null);

  // Flèche d'accès à la parcelle
  const [accessMode, setAccessMode] = useState(false);
  const [accessPoint, setAccessPoint] = useState<AccessPoint | null>(null);

  // Constructions existantes BDTOPO
  const [existingBuildings, setExistingBuildings] = useState<Building[]>([]);
  const [loadingBuildings, setLoadingBuildings] = useState(false);
  const [buildingsQueried, setBuildingsQueried] = useState(false);

  // Dessin de projet
  const [drawMode, setDrawMode] = useState(false);
  const [drawShapeType, setDrawShapeType] = useState("batiment");
  const [drawNiveaux, setDrawNiveaux] = useState<Niveaux>("rdc");
  const [drawnShapes, setDrawnShapes] = useState<DrawnShape[]>([]);
  const [editMode, setEditMode] = useState<"drag" | "rotate" | "vertex" | null>(null);
  const [mapFullscreen, setMapFullscreen] = useState(false);
  useEffect(() => {
    if (!mapFullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMapFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mapFullscreen]);


  // Step 2 — description du projet
  const [projectSurfaceM2, setProjectSurfaceM2] = useState("");
  const [projectDescriptionLibre, setProjectDescriptionLibre] = useState("");

  // Step 2 — type de projet + analyse IA
  const [projectType, setProjectType] = useState<string | null>(null);
  const [agrandWizard, setAgrandWizard]   = useState<AgrandWizard>({ surface: null, typeDetail: null, seuil: null });
  const [piscineWizard, setPiscineWizard] = useState<PiscineWizard>({ type: null, surface: null, abri: null });
  const [abriWizard, setAbriWizard]         = useState<AbriWizard>({ type: null, surface: null, implantation: null });
  const [terrasseWizard, setTerrasseWizard] = useState<TerrasseWizard>({ type: null, surface: null, couverture: null });
  const [analyzing, setAnalyzing] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysis | null>(null);
  const [analyzeError, setAnalyzeError] = useState(false);
  const [analyzeOverloaded, setAnalyzeOverloaded] = useState(false);
  const [showCotesStep4, setShowCotesStep4] = useState(false);
  const [measureMode, setMeasureMode] = useState(false);
  const [manualMeasures, setManualMeasures] = useState<ManualMeasure[]>([]);
  const [showZoneConstructible, setShowZoneConstructible] = useState(false);
  const [tipIdx, setTipIdx] = useState(0);
  const [tipVisible, setTipVisible] = useState(true);
  const [rules, setRules] = useState<Rules>({ retraitVoie: "", retraitLateral: "", retraitFond: "", empriseMax: "", hauteurMax: "" });

  // ZAC — règlement complémentaire (step 4, ancien flux)
  const [zacFile, setZacFile] = useState<File | null>(null);
  const [analyzingZac, setAnalyzingZac] = useState(false);
  const [zacAnalysis, setZacAnalysis] = useState<LotissementAnalysis | null>(null);
  const [zacAnalysisError, setZacAnalysisError] = useState(false);

  // Question ZAC / lotissement (step 1 — avant dessin)
  const [isInZac, setIsInZac] = useState<boolean | null>(null);
  const [cpapFileZac, setCpapFileZac] = useState<File | null>(null);
  const [noCpapZac, setNoCpapZac] = useState(false);

  async function loadExistingBuildings(geometry: { type: string; coordinates: unknown }) {
    setLoadingBuildings(true);
    setExistingBuildings([]);
    setBuildingsQueried(false);
    try {
      // Calcule le BBOX depuis la géométrie (fonctionne pour Polygon et MultiPolygon)
      let allPts: [number, number][] = [];
      if (geometry.type === "Polygon") {
        allPts = (geometry.coordinates as [number, number][][])[0];
      } else if (geometry.type === "MultiPolygon") {
        allPts = (geometry.coordinates as [number, number][][][])[0][0];
      }
      if (allPts.length === 0) { setLoadingBuildings(false); setBuildingsQueried(true); return; }

      // allPts sont en [lon, lat] (GeoJSON) — anneau de la parcelle pour le filtre pip
      const parcelRing = allPts.map(([lon, lat]) => [lon, lat] as [number, number]);

      const lons = allPts.map(([lon]) => lon);
      const lats = allPts.map(([, lat]) => lat);
      const west = Math.min(...lons), east = Math.max(...lons);
      const south = Math.min(...lats), north = Math.max(...lats);
      const bbox = `${west},${south},${east},${north},CRS:84`;

      const qs = [
        "SERVICE=WFS", "VERSION=2.0.0", "REQUEST=GetFeature",
        "outputFormat=application%2Fjson",
        "typeName=BDTOPO_V3%3Abatiment",
        "count=50", "SRSNAME=CRS%3A84",
        `BBOX=${encodeURIComponent(bbox)}`,
      ].join("&");

      const res = await fetch(`https://data.geopf.fr/wfs/ows?${qs}`);
      if (!res.ok) {
        console.error("[BDTOPO] HTTP", res.status, await res.text().catch(() => ""));
        setLoadingBuildings(false); setBuildingsQueried(true); return;
      }
      const data = await res.json();
      const buildings: Building[] = (data.features ?? []).flatMap((f: Record<string, unknown>) => {
        try {
          const geom = f.geometry as { type: string; coordinates: unknown };
          if (!geom) return [];
          const ring: [number, number][] =
            geom.type === "Polygon"
              ? (geom.coordinates as [number, number][][])[0]
              : (geom.coordinates as [number, number][][][])[0][0];

          // Filtre : centroïde du bâtiment doit être à l'intérieur de la parcelle
          const centLon = ring.reduce((s, p) => s + p[0], 0) / ring.length;
          const centLat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
          if (!pointInPolygon(centLon, centLat, parcelRing)) return [];

          const p = f.properties as Record<string, unknown>;
          return [{
            polygon: ring.map(([lon, lat]) => [lat, lon] as [number, number]),
            footprintM2: Math.round(ringAreaM2(ring)),
            hauteur: typeof p.hauteur === "number" ? Math.round((p.hauteur as number) * 10) / 10 : 0,
            nbEtages: typeof p.nombre_d_etages === "number" ? (p.nombre_d_etages as number) : 0,
            usage: typeof p.usage_1 === "string" ? (p.usage_1 as string) : "Inconnu",
          }];
        } catch { return []; }
      });
      setExistingBuildings(buildings);
    } catch (e) {
      console.error("[BDTOPO] fetch error:", e);
    }
    setLoadingBuildings(false);
    setBuildingsQueried(true);
  }

  async function applyParcelData(parcelData: ParcelData | null) {
    if (!parcelData) { setParcelError(true); setLoadingMap(false); return; }
    setParcelError(false);
    setParcel(parcelData);
    // Centre la carte sur la parcelle trouvée
    setMapCenter([parcelData.centLat, parcelData.centLon]);
    setMapZoom(19);
    // Récupère la zone PLU
    const zoneData = await loadZonePlu(parcelData.centLon, parcelData.centLat);
    setLoadingMap(false);
    if (!zoneData) setPluWarning(true);
    else { setPluWarning(false); setZone(zoneData); }
  }

  // Clic sur une parcelle vectorielle → sélection directe (pas d'appel API supplémentaire)
  async function handleParcelSelect(feature: GeoFeature) {
    if (accessMode || drawMode || editMode) return;
    setLoadingMap(true);
    setParcelError(false);
    setSelectedFeature(feature);
    setExistingBuildings([]);
    setBuildingsQueried(false);
    setEditMode(null);
    try {
      const parcelData = featureToParcel(feature as unknown as Record<string, unknown>, address || "");
      await applyParcelData(parcelData);
      loadExistingBuildings(feature.geometry);
    } catch {
      setParcelError(true);
      setLoadingMap(false);
    }
  }

  // Adresse → centre la carte uniquement (ne sélectionne pas de parcelle)
  function onAddrChange(val: string) {
    setAddress(val);
    if (addrDebounce.current) clearTimeout(addrDebounce.current);
    if (val.trim().length < 3) { setAddrSuggestions([]); return; }
    addrDebounce.current = setTimeout(async () => {
      const r = await searchBAN(val);
      setAddrSuggestions(r);
      setShowAddrList(true);
    }, 300);
  }

  function onAddrSelect(s: Suggestion) {
    setAddress(s.label);
    setAddrSuggestions([]);
    setShowAddrList(false);
    setMapCenter([s.lat, s.lon]);
    setMapZoom(18);
    setAddrLon(s.lon);
    setAddrLat(s.lat);
    setParcel(null);
    setSelectedFeature(null);
    setZone(null);
    setParcelError(false);
    setPluWarning(false);
    setExistingBuildings([]);
    // En mode lotissement, lookup automatique de la zone PLU depuis les coords de l'adresse
    if (isLotissement) {
      loadZonePlu(s.lon, s.lat).then((zoneData) => {
        if (!zoneData) setPluWarning(true);
        else { setPluWarning(false); setZone(zoneData); }
      });
    }
  }

  async function activateLotMode() {
    setIsLotissement(true);
    setParcel(null);
    setSelectedFeature(null);
    setParcelError(false);
    if (addrLon !== null && addrLat !== null) {
      const zoneData = await loadZonePlu(addrLon, addrLat);
      if (!zoneData) setPluWarning(true);
      else { setPluWarning(false); setZone(zoneData); }
    }
  }

  function lotPolygonToParcel(lot: LotPolygon): ParcelData {
    const lats = lot.polygon.map(([lat]) => lat);
    const lons = lot.polygon.map(([, lon]) => lon);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    const centLat = (minLat + maxLat) / 2;
    const centLon = (minLon + maxLon) / 2;
    const largeur = Math.round(geoDistM(centLat, minLon, centLat, maxLon));
    const profondeur = Math.round(geoDistM(minLat, centLon, maxLat, centLon));
    const surface = lot.surface > 0 ? lot.surface : Math.round(largeur * profondeur);
    return {
      ref: lot.id,
      surface,
      largeur,
      profondeur,
      coordinates: lot.polygon.map(([lat, lon]) => [lon, lat] as [number, number]),
      voie: address || "",
      centLon,
      centLat,
    };
  }

  function handleLotSelect(lot: LotPolygon) {
    setSelectedLotId(lot.id);
    setBuildingsQueried(false);
    setExistingBuildings([]);
    if (lot.polygon.length === 0) {
      // Mode sans polygone : pré-remplit la surface, l'utilisateur clique ensuite sur la carte
      if (lot.surface > 0) setLotSurface(String(lot.surface));
      return;
    }
    const parcelData = lotPolygonToParcel(lot);
    setParcel(parcelData);
    setMapCenter([parcelData.centLat, parcelData.centLon]);
    setMapZoom(19);
    // Query bâtiments sur la parcelle mère
    loadExistingBuildings({
      type: "Polygon",
      coordinates: [lot.polygon.map(([lat, lon]) => [lon, lat] as [number, number])],
    });
    loadZonePlu(parcelData.centLon, parcelData.centLat).then((zoneData) => {
      if (!zoneData) setPluWarning(true);
      else { setPluWarning(false); setZone(zoneData); }
    });
  }

  async function handlePlanLotAnalysis() {
    if (!lotPlanFile) return;
    setAnalyzingLotPlan(true);
    setLotPlanError(null);
    setLotPolygons([]);
    setSelectedLotId(null);
    setLotAnchored(null);
    setLotNoPolygon(false);
    setParcel(null);
    try {
      const fd = new FormData();
      fd.append("planLot", lotPlanFile);
      const res = await fetch("/api/plan-lot-analysis", { method: "POST", body: fd });
      const data = await res.json();

      if (!res.ok || (data.error && data.error !== null)) {
        setLotPlanError(data.message ?? "Erreur lors de l'analyse du plan.");
        setAnalyzingLotPlan(false);
        return;
      }

      const lots: LotPolygon[] = data.lots ?? [];

      if (lots.length === 0) {
        setLotPlanError(data.message ?? "Aucun lot détecté dans le document.");
        setAnalyzingLotPlan(false);
        return;
      }

      setLotPolygons(lots);
      setLotAnchored(data.anchored ?? false);
      setLotNoPolygon(data.noPolygon ?? false);

      // Centre la carte sur le polygone seulement si on en a un
      const hasPolygon = lots[0]?.polygon.length > 0;
      if (hasPolygon) {
        const allPts = lots.flatMap((l) => l.polygon);
        const lats = allPts.map(([lat]) => lat);
        const lons = allPts.map(([, lon]) => lon);
        setMapCenter([(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lons) + Math.max(...lons)) / 2]);
        setMapZoom(18);
      }

      // Auto-sélection si un seul lot avec polygone
      if (lots.length === 1 && hasPolygon) handleLotSelect(lots[0]);
      // Si noPolygon et un seul lot : pré-remplit juste la surface
      if (lots.length === 1 && !hasPolygon && lots[0].surface > 0) {
        setSelectedLotId(lots[0].id);
        setLotSurface(String(lots[0].surface));
      }
    } catch (e) {
      console.error("handlePlanLotAnalysis error:", e);
      setLotPlanError("Impossible de contacter l'API. Vérifiez votre connexion.");
    }
    setAnalyzingLotPlan(false);
  }

  function handleGoToStep2() {
    // Fallback manuel si aucun lot sélectionné
    if (isLotissement && !parcel && addrLon !== null && addrLat !== null) {
      const surf = parseInt(lotSurface) || 200;
      const dim = Math.round(Math.sqrt(surf));
      setParcel({
        ref: "Lot en cours de cadastrage",
        surface: surf,
        largeur: dim,
        profondeur: dim,
        coordinates: [],
        voie: address || "",
        centLon: addrLon,
        centLat: addrLat,
      });
    }
    setStep(2);
  }

  // Rotation des tips pendant l'analyse PLU
  useEffect(() => {
    if (!analyzing) { setTipVisible(true); return; }
    const interval = setInterval(() => {
      setTipVisible(false);
      setTimeout(() => {
        setTipIdx((i) => (i + 1) % PLU_TIPS.length);
        setTipVisible(true);
      }, 350);
    }, 4500);
    return () => clearInterval(interval);
  }, [analyzing]);

  async function handleGoToStep3() {
    await handleAnalyze();
    setStep(3);
  }

  // Commune (mode référence)
  function onCommuneChange(val: string) {
    setCommune(val);
    setSelectedCommune(null);
    if (communeDebounce.current) clearTimeout(communeDebounce.current);
    if (val.trim().length < 2) { setCommuneSuggestions([]); return; }
    communeDebounce.current = setTimeout(async () => {
      const r = await searchCommune(val);
      setCommuneSuggestions(r);
      setShowCommuneList(true);
    }, 300);
  }

  function onCommuneSelect(s: CommuneSuggestion) {
    setCommune(s.label);
    setSelectedCommune(s);
    setCommuneSuggestions([]);
    setShowCommuneList(false);
  }

  async function onRefSearch() {
    if (!selectedCommune || !section.trim() || !refNumero.trim()) return;
    setLoadingMap(true);
    setParcel(null);
    setZone(null);
    setParcelError(false);
    const parcelData = await loadParcelByRef(selectedCommune.codeInsee, section, refNumero, selectedCommune.label);
    await applyParcelData(parcelData);
  }

  async function handleAnalyze() {
    if (!projectType || !parcel) return;
    const agrandComplete  = agrandWizard.surface && agrandWizard.typeDetail && agrandWizard.seuil;
    const piscineComplete = piscineWizard.type && piscineWizard.surface && piscineWizard.abri;
    const abriComplete     = abriWizard.type && abriWizard.surface && abriWizard.implantation;
    const terrasseComplete = terrasseWizard.type && terrasseWizard.surface && terrasseWizard.couverture;
    if (projectType === "agrandissement" && !agrandComplete)    return;
    if (projectType === "piscine"        && !piscineComplete)   return;
    if (projectType === "abri"           && !abriComplete)      return;
    if (projectType === "terrasse"       && !terrasseComplete)  return;
    setAnalyzing(true);
    setAnalyzeError(false);
    setAnalyzeOverloaded(false);
    setAiAnalysis(null);
    try {
      // Lecture du CPAP en base64 côté client (FileReader, compatible navigateur)
      // Priorité : CPAP lotissement (isLotissement) > CPAP ZAC (question step 1)
      const effectiveCpap = (isLotissement ? cpapFile : null) ?? cpapFileZac ?? null;
      let cpapBase64: string | undefined;
      let cpapMimeType: string | undefined;
      if (effectiveCpap) {
        cpapBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            resolve(dataUrl.split(",")[1]);
          };
          reader.onerror = reject;
          reader.readAsDataURL(effectiveCpap);
        });
        cpapMimeType = effectiveCpap.type || "application/pdf";
      }

      const res = await fetch("/api/plu-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commune: selectedCommune?.label ?? address.split(",").pop()?.trim() ?? "",
          zoneLibelle: zone?.libelle ?? "non précisée",
          zoneDescription: zone?.description ?? "",
          partition: zone?.partition ?? "",
          nomfic: zone?.nomfic ?? "",
          gpuDocId: zone?.gpuDocId ?? "",
          projectType,
          agrandissementDetails: projectType === "agrandissement" ? agrandWizard  : undefined,
          piscineDetails:        projectType === "piscine"        ? piscineWizard : undefined,
          abriDetails:           projectType === "abri"           ? abriWizard    : undefined,
          terrasseDetails:       projectType === "terrasse"       ? terrasseWizard : undefined,
          cpapBase64,
          cpapMimeType,
          surface: parcel.surface,
          largeur: parcel.largeur,
          profondeur: parcel.profondeur,
          existingBuildings: existingBuildings.length > 0 ? existingBuildings.map((b) => ({
            usage: b.usage,
            footprintM2: b.footprintM2,
            hauteur: b.hauteur,
            nbEtages: b.nbEtages,
          })) : undefined,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { overloaded?: boolean };
        setAnalyzeOverloaded(!!errData.overloaded);
        throw new Error("API error");
      }
      const data: AiAnalysis = await res.json();
      setAiAnalysis(data);
      setRules({
        retraitVoie: String(data.retraitVoie),
        retraitLateral: String(data.retraitLateral),
        retraitFond: String(data.retraitFond),
        empriseMax: String(data.empriseMax),
        hauteurMax: String(data.hauteurMax),
      });

      // Génération automatique du parking non clos orienté selon la flèche d'accès
      if (accessPoint) {
        const nPlaces = Math.max(1, data.parkingNombrePlaces ?? 1);
        const places: 1 | 2 = nPlaces >= 2 ? 2 : 1;

        let opt = places === 1 ? PARKING_OPTIONS_1 : PARKING_SIDE_BY_SIDE;

        // Extrait la ring parcellaire une seule fois (réutilisée pour mesure et clipping)
        let parcelRingForParking: [number, number][] | null = null;
        if (selectedFeature) {
          const g = selectedFeature.geometry;
          if (g.type === "Polygon") parcelRingForParking = (g.coordinates as [number, number][][])[0];
          else if (g.type === "MultiPolygon") parcelRingForParking = (g.coordinates as [number, number][][][])[0][0];
        }

        // Pour 2 places : vérifie si la largeur disponible permet le côte à côte (≥ 5 m)
        // sinon bascule en enfilade (3 × 10 m)
        if (places === 2 && parcelRingForParking) {
          const availWidth = measureAccessWidth(accessPoint, parcelRingForParking);
          if (availWidth < 5) opt = PARKING_TANDEM;
        }

        const poly = buildParkingPolygon(accessPoint, opt.w, opt.d, parcelRingForParking);
        setDrawnShapes((prev) => [
          ...prev.filter((s) => s.id !== "parking-auto"),
          {
            id: "parking-auto",
            type: "autre",
            label: `🅿 ${opt.shortLabel}`,
            polygon: poly,
            surfaceM2: Math.round(opt.w * opt.d),
            niveaux: "annexe",
            nonEmprise: true,
          },
        ]);
      }
    } catch {
      setAnalyzeError(true);
    }
    setAnalyzing(false);
  }

  async function handleZacAnalysis() {
    if (!zacFile) return;
    setAnalyzingZac(true);
    setZacAnalysisError(false);
    setZacAnalysis(null);
    try {
      const fd = new FormData();
      fd.append("ccap", zacFile);
      const res = await fetch("/api/lotissement-analysis", { method: "POST", body: fd });
      if (!res.ok) throw new Error("error");
      setZacAnalysis(await res.json());
    } catch {
      setZacAnalysisError(true);
    }
    setAnalyzingZac(false);
  }

  function setRule(k: keyof Rules, v: string) {
    setRules((prev) => ({ ...prev, [k]: v }));
  }

  const hasParcelOrLot = parcel !== null || (isLotissement && addrLon !== null && lotSurface !== "");
  const zacAnswered = isInZac === false || (isInZac === true && (cpapFileZac !== null || noCpapZac));
  const canGoToStep2 = hasParcelOrLot && accessPoint !== null && zacAnswered;
  const canSearchByRef = selectedCommune !== null && section.trim() !== "" && refNumero.trim() !== "";
  const canGoToStep3 = projectType !== null;

  const stepLabels = [
    { n: 1, label: "Parcelle" },
    { n: 2, label: "Projet" },
    { n: 3, label: "Dessin" },
    { n: 4, label: "Bilan" },
  ];

  return (
    <div className="space-y-8">
      {/* ── Overlay analyse PLU ── */}
      {analyzing && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-anthracite/50 backdrop-blur-sm">
          <div className="bg-white shadow-2xl max-w-sm w-full mx-4 px-8 py-8 space-y-6">
            {/* Spinner + titre */}
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="inline-block w-8 h-8 border-[3px] border-terracotta/30 border-t-terracotta rounded-full animate-spin" />
              <p className="text-[11px] font-semibold tracking-[0.18em] uppercase text-muted">
                Lecture du PLU{cpapFileZac ? " et du CPAP" : ""}…
              </p>
            </div>
            {/* Tip avec fondu */}
            <div className={`transition-opacity duration-350 ${tipVisible ? "opacity-100" : "opacity-0"} min-h-[72px]`}>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-terracotta mb-2">
                {PLU_TIPS[tipIdx].cat}
              </p>
              <p className="text-[13px] text-anthracite leading-relaxed">
                {PLU_TIPS[tipIdx].text}
              </p>
            </div>
            {/* Indicateurs */}
            <div className="flex flex-wrap gap-1.5 justify-center">
              {PLU_TIPS.map((_, i) => (
                <div
                  key={i}
                  className={`h-0.5 rounded-full transition-all duration-300 ${
                    i === tipIdx ? "bg-terracotta w-5" : "bg-warm-gray w-1.5"
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Indicateurs */}
      <div className="flex items-center gap-0">
        {stepLabels.map((s, i) => (
          <div key={s.n} className="flex items-center">
            <div className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${step === s.n ? "bg-terracotta text-white" : step > s.n ? "bg-terracotta/40 text-white" : "bg-warm-gray text-muted"}`}>{s.n}</div>
              <span className={`text-xs tracking-wide hidden sm:inline ${step === s.n ? "text-anthracite font-medium" : "text-muted"}`}>{s.label}</span>
            </div>
            {i < stepLabels.length - 1 && <div className="w-8 sm:w-16 h-px bg-warm-gray mx-2 sm:mx-3" />}
          </div>
        ))}
      </div>

      {/* ── ÉTAPE 1 ── */}
      {step === 1 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-light text-anthracite mb-1">Sélectionner la parcelle</h2>
            <p className="text-sm text-muted">
              Recherchez une adresse pour centrer la carte, puis <strong className="font-medium text-anthracite">cliquez directement sur la parcelle</strong> pour la sélectionner. Ou utilisez la référence cadastrale.
            </p>
          </div>

          {/* Ligne de recherche */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Par adresse */}
            <div className="space-y-1">
              <AutocompleteInput
                label="Centrer sur une adresse"
                value={address}
                onChange={onAddrChange}
                suggestions={addrSuggestions}
                onSelect={onAddrSelect}
                placeholder="Ex : rue des Avens, Junas"
                showList={showAddrList}
                onFocus={() => addrSuggestions.length > 0 && setShowAddrList(true)}
                onHideList={() => setShowAddrList(false)}
              />
              <p className="text-[11px] text-muted">Centre la carte — puis cliquez la parcelle.</p>
            </div>

            {/* Par référence */}
            <div className="space-y-2">
              <p className="text-[11px] font-medium tracking-[0.12em] uppercase text-muted">Ou par référence cadastrale</p>
              <div className="flex gap-2">
                <div className="flex-1 min-w-0">
                  <AutocompleteInput
                    label=""
                    value={commune}
                    onChange={onCommuneChange}
                    suggestions={communeSuggestions}
                    onSelect={onCommuneSelect}
                    placeholder="Commune"
                    showList={showCommuneList}
                    onFocus={() => communeSuggestions.length > 0 && setShowCommuneList(true)}
                    onHideList={() => setShowCommuneList(false)}
                  />
                </div>
                <input type="text" value={section} onChange={(e) => setSection(e.target.value)}
                  placeholder="Section" className="w-24 border border-warm-gray bg-white px-2 py-3 text-sm text-anthracite outline-none focus:border-terracotta transition-colors uppercase" />
                <input type="text" value={refNumero} onChange={(e) => setRefNumero(e.target.value)}
                  placeholder="N°" className="w-20 border border-warm-gray bg-white px-2 py-3 text-sm text-anthracite outline-none focus:border-terracotta transition-colors" />
                <button type="button" disabled={!canSearchByRef || loadingMap} onClick={onRefSearch}
                  className="shrink-0 bg-terracotta text-white text-xs font-semibold tracking-wide uppercase px-4 py-3 hover:bg-terracotta-dark transition-colors disabled:opacity-40">
                  OK
                </button>
              </div>
              <p className="text-[11px] text-muted">Trouvez la référence sur <a href="https://www.cadastre.gouv.fr" target="_blank" rel="noopener noreferrer" className="underline">cadastre.gouv.fr</a> ou sur votre avis de taxe foncière.</p>
            </div>
          </div>

          {/* Carte — sélection de la parcelle uniquement */}
          <div className="relative">
            <MapPicker
              center={mapCenter}
              zoom={mapZoom}
              selectedFeature={selectedFeature}
              onParcelSelect={handleParcelSelect}
              fullscreen={mapFullscreen}
              onToggleFullscreen={() => setMapFullscreen((v) => !v)}
              lotPolygons={
                lotPolygons.length > 0 && !lotNoPolygon && lotPolygons[0].polygon.length > 0
                  ? [lotPolygons[0]]
                  : undefined
              }
              selectedLotId={null}
              onLotSelect={undefined}
              accessMode={accessMode}
              accessPoint={accessPoint}
              onAccessPointSet={(pt) => { setAccessPoint(pt); setAccessMode(false); }}
              existingBuildings={existingBuildings}
              drawMode={false}
              drawShapeType={drawShapeType}
              drawnShapes={drawnShapes}
              onShapeDrawn={(s) => setDrawnShapes((prev) => [...prev, s])}
              onShapeUpdated={(id, polygon, surfaceM2) =>
                setDrawnShapes((prev) =>
                  prev.map((s) => (s.id === id ? { ...s, polygon, surfaceM2 } : s)),
                )
              }
              editMode={null}
            />
            {/* Overlay accès véhicule */}
            {parcel && (
              <div
                className="absolute top-2 left-2 z-[1000] bg-white/95 backdrop-blur-sm border border-gray-200 rounded-xl shadow-lg p-3 w-52"
              >
                <p className="text-[11px] font-semibold text-anthracite tracking-wide uppercase mb-2">Accès véhicule</p>
                {accessPoint ? (
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-green-700 font-medium">Accès positionné ✓</span>
                    <div className="flex gap-2">
                      <button type="button"
                        onClick={() => { setAccessMode(true); setAccessPoint(null); }}
                        className="text-muted underline hover:text-anthracite transition-colors">
                        Modifier
                      </button>
                      <button type="button"
                        onClick={() => { setAccessPoint(null); setAccessMode(false); }}
                        className="text-red-400 underline hover:text-red-600 transition-colors">
                        Suppr.
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAccessMode((v) => !v)}
                    className={`w-full py-1.5 text-[11px] font-semibold rounded border transition-colors ${
                      accessMode
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white text-anthracite border-warm-gray hover:border-blue-400 hover:text-blue-700"
                    }`}
                  >
                    {accessMode ? "✓ Cliquez sur la carte…" : "⬡ Placer l'accès"}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ── Lien escape hatch — toujours visible sous la carte ── */}
          {!isLotissement && (
            <button
              type="button"
              onClick={activateLotMode}
              className="text-[11px] text-muted hover:text-anthracite transition-colors underline"
            >
              Parcelle introuvable sur la carte ? → Terrain en lotissement récent
            </button>
          )}

          {/* ── Mode lotissement récent ── */}
          {isLotissement && (
            <div className="border border-amber-200 bg-amber-50/30 p-5 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-anthracite mb-1">Mode lotissement récent</p>
                  <p className="text-[11px] text-amber-800 leading-relaxed">
                    Importez le plan de lot du géomètre pour que l&apos;IA dessine votre parcelle sur la carte. Puis sélectionnez votre lot.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsLotissement(false); setLotPlanFile(null); setCpapFile(null);
                    setLotPolygons([]); setSelectedLotId(null);
                    setLotAnchored(null); setLotNoPolygon(false);
                    setLotPlanError(null); setZone(null); setPluWarning(false);
                  }}
                  className="shrink-0 text-[11px] text-muted hover:text-anthracite underline transition-colors whitespace-nowrap"
                >
                  ← Retour carte
                </button>
              </div>

              {/* Zone PLU depuis l'adresse */}
              {addrLon !== null ? (
                zone ? (
                  <div className="border-l-2 border-terracotta pl-3">
                    <p className="text-[10px] text-muted uppercase tracking-wide mb-0.5">Zone PLU détectée</p>
                    <p className="font-semibold text-anthracite">{zone.libelle} <span className="font-normal text-muted text-sm">— {zone.description}</span></p>
                  </div>
                ) : pluWarning ? (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2">
                    PLU non numérisé pour cette commune. Les règles seront analysées depuis le CPAP du lotissement.
                  </p>
                ) : (
                  <p className="text-[11px] text-muted italic">Recherche de la zone PLU…</p>
                )
              ) : (
                <p className="text-[11px] text-amber-800">
                  Recherchez d&apos;abord une adresse ci-dessus pour localiser la zone PLU automatiquement.
                </p>
              )}

              {/* Upload plan de lot */}
              <div>
                <p className="text-[11px] font-medium tracking-[0.12em] uppercase text-muted mb-2">
                  Plan de division (géomètre-expert)
                </p>
                <label className="flex flex-col items-center justify-center gap-1.5 w-full h-24 border-2 border-dashed border-warm-gray bg-white cursor-pointer hover:border-terracotta/50 transition-colors px-4 text-center">
                  <input type="file" accept=".pdf,image/*" className="hidden"
                    onChange={(e) => { setLotPlanFile(e.target.files?.[0] ?? null); setLotPolygons([]); setSelectedLotId(null); setLotPlanError(null); setLotAnchored(null); setLotNoPolygon(false); }} />
                  <p className="text-xs font-medium text-anthracite">Plan du lot / plan de division</p>
                  {lotPlanFile
                    ? <p className="text-[10px] text-terracotta font-medium truncate max-w-full">{lotPlanFile.name}</p>
                    : <p className="text-[10px] text-muted">PDF ou image (JPG, PNG)</p>}
                </label>
              </div>

              {lotPlanFile && lotPolygons.length === 0 && (
                <button type="button" disabled={analyzingLotPlan} onClick={handlePlanLotAnalysis}
                  className="bg-anthracite text-warm-white text-xs font-semibold tracking-[0.2em] uppercase px-6 py-3 hover:bg-anthracite/80 transition-colors disabled:opacity-60 flex items-center gap-2.5">
                  {analyzingLotPlan
                    ? <><span className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />Analyse du plan…</>
                    : "Analyser le plan →"}
                </button>
              )}

              {lotPlanError && (
                <div className="border border-amber-200 bg-amber-50 px-4 py-3 space-y-1">
                  <p className="text-sm text-amber-900 font-medium">Analyse impossible</p>
                  <p className="text-[11px] text-amber-800 leading-relaxed">{lotPlanError}</p>
                </div>
              )}

              {/* Résultat : lots détectés */}
              {lotPolygons.length > 0 && (
                <div className="space-y-3">
                  {/* Bandeau statut ancrage */}
                  {lotAnchored === true && (
                    <div className="flex items-start gap-2 bg-green-50 border border-green-200 px-3 py-2 text-[11px] text-green-800">
                      <span className="shrink-0">✓</span>
                      <span>Parcelle cadastrale trouvée dans l&apos;IGN et affichée sur la carte (en violet). Sélectionnez votre lot ci-dessous.</span>
                    </div>
                  )}
                  {lotNoPolygon && (
                    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-800">
                      <span className="shrink-0">⚠</span>
                      <span>Lots détectés dans le plan mais parcelle non trouvée dans l&apos;IGN. Sélectionnez votre lot ci-dessous, puis cliquez sur votre parcelle dans la carte pour la localiser.</span>
                    </div>
                  )}

                  {/* Sélection du lot */}
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-medium tracking-[0.12em] uppercase text-muted">
                      {lotPolygons.length} lot{lotPolygons.length > 1 ? "s" : ""} détecté{lotPolygons.length > 1 ? "s" : ""} — sélectionnez le vôtre
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {lotPolygons.map((lot) => (
                        <button key={lot.id} type="button" onClick={() => handleLotSelect(lot)}
                          className={`text-xs px-3 py-1.5 border transition-colors ${selectedLotId === lot.id ? "border-indigo-500 bg-indigo-50 text-indigo-800 font-medium" : "border-warm-gray text-anthracite hover:border-indigo-300"}`}>
                          {lot.id}{lot.surface > 0 ? ` — ${lot.surface} m²` : ""}
                        </button>
                      ))}
                    </div>
                    {selectedLotId && <p className="text-[10px] text-green-700 font-medium">Lot sélectionné : {selectedLotId}</p>}
                  </div>
                </div>
              )}

              {/* Surface manuelle — toujours disponible en fallback */}
              {(!lotPlanFile || lotPlanError || lotNoPolygon) && (
                <div>
                  <label className="block text-[11px] font-medium tracking-[0.12em] uppercase text-muted mb-1.5">
                    {lotPolygons.length > 0 ? "Surface du lot (si non indiquée ci-dessus)" : "Surface du lot (saisie manuelle)"}
                  </label>
                  <div className="flex items-center border border-warm-gray bg-white focus-within:border-terracotta transition-colors max-w-[180px]">
                    <input type="number" min={1} value={lotSurface} onChange={(e) => setLotSurface(e.target.value)}
                      placeholder="ex : 450"
                      className="flex-1 px-3 py-2.5 text-sm text-anthracite bg-transparent outline-none" />
                    <span className="px-3 text-xs text-muted border-l border-warm-gray bg-warm-gray/30 py-2.5 select-none">m²</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Erreur (mode normal seulement) */}
          {parcelError && !isLotissement && (
            <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 rounded-sm">
              Aucune parcelle trouvée à cet endroit. Essayez de zoomer plus et de cliquer au centre de la parcelle.
            </div>
          )}

          {/* Infos parcelle sélectionnée (mode normal seulement) */}
          {parcel && !isLotissement && (
            <div className="border border-warm-gray bg-warm-gray/20 p-4 space-y-3">
              <p className="text-[11px] font-medium tracking-[0.12em] uppercase text-muted">Parcelle sélectionnée</p>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Référence", value: parcel.ref },
                  { label: "Surface", value: `${parcel.surface} m²` },
                  { label: "Dimensions", value: `~${parcel.largeur} × ${parcel.profondeur} m` },
                ].map((item) => (
                  <div key={item.label}>
                    <p className="text-[10px] text-muted uppercase tracking-wide mb-0.5">{item.label}</p>
                    <p className="text-sm font-medium text-anthracite">{item.value}</p>
                  </div>
                ))}
              </div>
              {zone && (
                <div className="border-l-2 border-terracotta pl-3">
                  <p className="text-[10px] text-muted uppercase tracking-wide mb-0.5">Zone PLU</p>
                  <p className="font-semibold text-anthracite">{zone.libelle} <span className="font-normal text-muted text-sm">— {zone.description}</span></p>
                </div>
              )}
              {pluWarning && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-sm">
                  PLU non numérisé pour cette commune sur le Géoportail de l&apos;Urbanisme. Consultez le PLU sur le site de votre mairie et saisissez les règles manuellement à l&apos;étape suivante.
                </p>
              )}
            </div>
          )}


          {/* ── Constructions existantes (BDTOPO IGN) ── */}
          {parcel && (loadingBuildings || buildingsQueried) && (
            <div className="border border-warm-gray p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-anthracite">Constructions existantes</p>
                <span className="text-[10px] text-muted uppercase tracking-wide">Source IGN BDTOPO</span>
              </div>

              {loadingBuildings && (
                <p className="text-[11px] text-muted italic flex items-center gap-2">
                  <span className="inline-block w-3 h-3 border-2 border-amber-400/40 border-t-amber-500 rounded-full animate-spin" />
                  Chargement des bâtiments…
                </p>
              )}

              {!loadingBuildings && existingBuildings.length === 0 && (
                <p className="text-[11px] text-muted">Aucun bâtiment détecté sur cette parcelle.</p>
              )}

              {existingBuildings.length > 0 && (
                <>
                  <div className="space-y-2">
                    {existingBuildings.map((b, i) => (
                      <div key={i} className="flex items-center justify-between text-[11px] border-b border-warm-gray pb-2 last:border-0 last:pb-0">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-sm bg-amber-400 shrink-0" />
                          <span className="text-anthracite font-medium">{formatUsage(b.usage)}</span>
                        </div>
                        <div className="flex gap-3 text-muted text-right">
                          <span>{b.footprintM2} m²</span>
                          <span>{b.hauteur} m</span>
                          <span>{b.nbEtages} ét.</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="bg-amber-50 border border-amber-200 px-3 py-2 flex justify-between text-[11px]">
                    <span className="font-medium text-amber-900">Emprise existante totale</span>
                    <span className="font-bold text-amber-900">
                      {existingBuildings.reduce((s, b) => s + b.footprintM2, 0)} m²
                    </span>
                  </div>
                </>
              )}
            </div>
          )}



          {/* ── Question ZAC / lotissement ── */}
          {hasParcelOrLot && accessPoint && (
            <div className="border border-warm-gray p-4 space-y-4">
              <div>
                <p className="text-sm font-medium text-anthracite mb-0.5">Votre terrain est-il dans une ZAC ou un lotissement ?</p>
                <p className="text-[11px] text-muted">Si oui, un CPAP peut s&apos;appliquer en complément du PLU.</p>
              </div>
              <div className="flex gap-3">
                <button type="button"
                  onClick={() => { setIsInZac(false); setCpapFileZac(null); setNoCpapZac(false); }}
                  className={`px-5 py-2 text-sm border transition-colors ${isInZac === false ? "bg-terracotta text-white border-terracotta" : "bg-white text-anthracite border-warm-gray hover:border-terracotta"}`}>
                  Non
                </button>
                <button type="button"
                  onClick={() => setIsInZac(true)}
                  className={`px-5 py-2 text-sm border transition-colors ${isInZac === true ? "bg-terracotta text-white border-terracotta" : "bg-white text-anthracite border-warm-gray hover:border-terracotta"}`}>
                  Oui
                </button>
              </div>

              {isInZac === true && (
                <div className="space-y-3 pt-3 border-t border-warm-gray">
                  <p className="text-[11px] font-medium text-anthracite">Chargez le CPAP (Cahier des Prescriptions Architecturales et Paysagères) :</p>
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <span className="bg-indigo-50 border border-indigo-200 px-3 py-2 text-[11px] text-indigo-800 font-medium group-hover:bg-indigo-100 transition-colors">
                      📄 Choisir un PDF
                    </span>
                    <input type="file" accept=".pdf" className="hidden"
                      onChange={(e) => { setCpapFileZac(e.target.files?.[0] ?? null); setNoCpapZac(false); }} />
                    {cpapFileZac
                      ? <span className="text-[11px] text-green-700 font-medium truncate max-w-[200px]">{cpapFileZac.name} ✓</span>
                      : <span className="text-[11px] text-muted">Aucun fichier sélectionné</span>}
                  </label>

                  {!cpapFileZac && (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={noCpapZac} onChange={(e) => setNoCpapZac(e.target.checked)} className="w-4 h-4 accent-terracotta" />
                      <span className="text-[11px] text-anthracite">Je ne dispose pas du CPAP</span>
                    </label>
                  )}

                  {noCpapZac && !cpapFileZac && (
                    <div className="bg-amber-50 border border-amber-200 px-3 py-2.5 text-[11px] text-amber-800 leading-relaxed">
                      Pour obtenir le CPAP, rapprochez-vous du <strong>lotisseur</strong>, du <strong>constructeur</strong> ou de votre <strong>mairie</strong>. L&apos;analyse sera basée sur le PLU uniquement.
                    </div>
                  )}

                  {cpapFileZac && (
                    <div className="bg-indigo-50 border border-indigo-200 px-3 py-2 text-[11px] text-indigo-800">
                      ✓ L&apos;IA analysera le PLU et votre CPAP avant la phase de dessin.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Warning accès manquant */}
          {hasParcelOrLot && !accessPoint && (
            <div className="border border-amber-200 bg-amber-50 px-4 py-2.5 text-[11px] text-amber-800 flex items-center gap-2">
              <span>⚠</span>
              <span>Placez l&apos;accès véhicule sur la carte (panneau en haut à gauche de la carte) avant de continuer.</span>
            </div>
          )}

          {canGoToStep2 && (
            <button type="button" onClick={handleGoToStep2}
              className="bg-terracotta text-white text-xs font-semibold tracking-[0.2em] uppercase px-8 py-3.5 hover:bg-terracotta-dark transition-colors">
              Étape suivante →
            </button>
          )}
        </div>
      )}

      {/* ── ÉTAPE 2 ── */}
      {step === 2 && parcel && (
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-light text-anthracite mb-1">Description du projet</h2>
            <p className="text-sm text-muted">
              Décrivez votre projet pour permettre l&apos;analyse PLU adaptée.
            </p>
          </div>

          {/* Sélecteur de type de projet */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {PROJECT_TYPES.map((pt) => (
              <button
                key={pt.key}
                type="button"
                onClick={() => {
                  setProjectType(pt.key);
                  setAiAnalysis(null);
                  setAnalyzeError(false);
                  setAnalyzeOverloaded(false);
                  setAgrandWizard({ surface: null, typeDetail: null, seuil: null });
                  setPiscineWizard({ type: null, surface: null, abri: null });
                  setAbriWizard({ type: null, surface: null, implantation: null });
                  setTerrasseWizard({ type: null, surface: null, couverture: null });
                }}
                className={`text-left p-4 border transition-colors ${
                  projectType === pt.key
                    ? "border-terracotta bg-terracotta/5"
                    : "border-warm-gray hover:border-terracotta/40"
                }`}
              >
                <p className="font-medium text-sm text-anthracite mb-0.5">{pt.label}</p>
                <p className="text-[11px] text-muted leading-snug">{pt.desc}</p>
              </button>
            ))}
          </div>

          {/* ── Wizard agrandissement ── */}
          {projectType === "agrandissement" && (
            <div className="space-y-5">
              {/* Q1 — Nature de la surface */}
              <WizardStep
                title="Quel type de surface souhaitez-vous créer ?"
                hint="La surface habitable est déclarée et comptabilisée dans la surface de plancher ; la surface non habitable (annexe) suit des règles différentes."
                options={[
                  { key: "habitable", label: "Surface habitable",      desc: "Compte dans la surface de plancher : pièce de vie, chambre, véranda chauffée…" },
                  { key: "annexe",    label: "Surface non habitable",   desc: "Ne compte pas dans la SP : garage, abri, local technique, atelier…" },
                ]}
                value={agrandWizard.surface}
                onChange={(v) => setAgrandWizard({ surface: v as AgrandSurface, typeDetail: null, seuil: null })}
              />

              {/* Q2 — Type détaillé */}
              {agrandWizard.surface === "habitable" && (
                <WizardStep
                  title="De quel type d'extension habitable s'agit-il ?"
                  options={WIZARD_TYPES_HABITABLE}
                  value={agrandWizard.typeDetail}
                  onChange={(v) => setAgrandWizard((w) => ({ ...w, typeDetail: v, seuil: null }))}
                  cols={4}
                />
              )}
              {agrandWizard.surface === "annexe" && (
                <WizardStep
                  title="Quel type d'annexe souhaitez-vous construire ?"
                  options={WIZARD_TYPES_ANNEXE}
                  value={agrandWizard.typeDetail}
                  onChange={(v) => setAgrandWizard((w) => ({ ...w, typeDetail: v, seuil: null }))}
                  cols={4}
                />
              )}

              {/* Q3 — Seuil de surface */}
              {agrandWizard.typeDetail && (
                <WizardStep
                  title="Quelle surface supplémentaire prévoyez-vous de créer ?"
                  hint="Ces seuils déterminent le type d'autorisation d'urbanisme nécessaire."
                  options={WIZARD_SEUILS}
                  value={agrandWizard.seuil}
                  onChange={(v) => setAgrandWizard((w) => ({ ...w, seuil: v as AgrandSeuil }))}
                  cols={3}
                />
              )}
            </div>
          )}

          {/* ── Wizard piscine ── */}
          {projectType === "piscine" && (
            <div className="space-y-5">
              <WizardStep
                title="Quel type de piscine ?"
                options={WIZARD_PISCINE_TYPES}
                value={piscineWizard.type}
                onChange={(v) => setPiscineWizard({ type: v as PiscineType, surface: null, abri: null })}
              />
              {piscineWizard.type && (
                <WizardStep
                  title="Quelle surface de bassin prévoyez-vous ?"
                  hint="La surface du bassin détermine le type d'autorisation d'urbanisme."
                  options={WIZARD_PISCINE_SURFACES}
                  value={piscineWizard.surface}
                  onChange={(v) => setPiscineWizard((w) => ({ ...w, surface: v as PiscineSurface, abri: null }))}
                  cols={3}
                />
              )}
              {piscineWizard.surface && (
                <WizardStep
                  title="Y aura-t-il un abri ou une couverture ?"
                  hint="Un abri fixe ou rétractable de plus de 1,80 m de hauteur impose un permis de construire."
                  options={WIZARD_PISCINE_ABRI}
                  value={piscineWizard.abri}
                  onChange={(v) => setPiscineWizard((w) => ({ ...w, abri: v as PiscineAbri }))}
                />
              )}
            </div>
          )}

          {/* ── Wizard abri / pergola / véranda ── */}
          {projectType === "abri" && (
            <div className="space-y-5">
              <WizardStep
                title="Quel type d'ouvrage souhaitez-vous réaliser ?"
                options={WIZARD_ABRI_TYPES}
                value={abriWizard.type}
                onChange={(v) => setAbriWizard({ type: v as AbriType, surface: null, implantation: null })}
                cols={4}
              />
              {abriWizard.type && (
                <WizardStep
                  title="Quelle surface au sol prévoyez-vous ?"
                  hint="La surface détermine le type d'autorisation d'urbanisme nécessaire."
                  options={WIZARD_ABRI_SURFACES}
                  value={abriWizard.surface}
                  onChange={(v) => setAbriWizard((w) => ({ ...w, surface: v as AbriSurface, implantation: null }))}
                  cols={3}
                />
              )}
              {abriWizard.surface && (
                <WizardStep
                  title="Comment sera-t-il implanté ?"
                  options={WIZARD_ABRI_IMPLANTATION}
                  value={abriWizard.implantation}
                  onChange={(v) => setAbriWizard((w) => ({ ...w, implantation: v as AbriImplantation }))}
                />
              )}
            </div>
          )}

          {/* ── Wizard terrasse ── */}
          {projectType === "terrasse" && (
            <div className="space-y-5">
              <WizardStep
                title="Quel type de terrasse souhaitez-vous réaliser ?"
                hint="La hauteur de la terrasse par rapport au sol naturel change le régime réglementaire applicable."
                options={WIZARD_TERRASSE_TYPES}
                value={terrasseWizard.type}
                onChange={(v) => setTerrasseWizard({ type: v as TerrasseType, surface: null, couverture: null })}
              />
              {terrasseWizard.type && (
                <WizardStep
                  title="Quelle surface prévoyez-vous ?"
                  options={WIZARD_TERRASSE_SURFACES}
                  value={terrasseWizard.surface}
                  onChange={(v) => setTerrasseWizard((w) => ({ ...w, surface: v as TerrasseSurface, couverture: null }))}
                  cols={3}
                />
              )}
              {terrasseWizard.surface && (
                <WizardStep
                  title="La terrasse sera-t-elle couverte ?"
                  hint="Un auvent ou une pergola couverte est comptabilisé dans l'emprise au sol."
                  options={WIZARD_TERRASSE_COUVERTURE}
                  value={terrasseWizard.couverture}
                  onChange={(v) => setTerrasseWizard((w) => ({ ...w, couverture: v as TerrasseCouverture }))}
                />
              )}
            </div>
          )}

          {/* Surface souhaitée + description libre */}
          <div className="space-y-4 pt-2">
            <div className="max-w-[200px]">
              <label className="block text-[11px] font-medium tracking-[0.12em] uppercase text-muted mb-1.5">
                Surface souhaitée (indicatif)
              </label>
              <div className="flex items-center border border-warm-gray bg-white focus-within:border-terracotta transition-colors">
                <input
                  type="number"
                  min={1}
                  value={projectSurfaceM2}
                  onChange={(e) => setProjectSurfaceM2(e.target.value)}
                  placeholder="ex : 25"
                  className="flex-1 px-3 py-2.5 text-sm text-anthracite bg-transparent outline-none"
                />
                <span className="px-3 text-xs text-muted border-l border-warm-gray bg-warm-gray/30 py-2.5 select-none">m²</span>
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium tracking-[0.12em] uppercase text-muted mb-1.5">
                Description du projet (optionnel)
              </label>
              <textarea
                value={projectDescriptionLibre}
                onChange={(e) => setProjectDescriptionLibre(e.target.value)}
                placeholder="Ex : Extension de la cuisine côté jardin, plain-pied, toit plat, 4 × 6 m…"
                rows={3}
                className="w-full border border-warm-gray bg-white px-3 py-2.5 text-sm text-anthracite outline-none focus:border-terracotta transition-colors resize-none"
              />
            </div>
          </div>

          <div className="flex gap-3 flex-wrap">
            <button type="button" onClick={() => setStep(1)}
              className="border border-warm-gray text-anthracite text-xs font-semibold tracking-[0.2em] uppercase px-6 py-3 hover:bg-warm-gray/40 transition-colors">
              ← Retour
            </button>
            <button type="button" disabled={!canGoToStep3 || analyzing} onClick={handleGoToStep3}
              className="bg-terracotta text-white text-xs font-semibold tracking-[0.2em] uppercase px-8 py-3 hover:bg-terracotta-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2.5">
              {analyzing ? (
                <>
                  <span className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Analyse PLU…
                </>
              ) : "Dessiner →"}
            </button>
          </div>

        </div>
      )}

      {/* ── ÉTAPE 3 ── */}
      {step === 3 && parcel && (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-light text-anthracite mb-1">Dessiner le projet</h2>
            <p className="text-sm text-muted">
              Tracez les contours de vos constructions directement sur la parcelle.
            </p>
          </div>

          {/* Carte avec outils de dessin */}
          <div className="relative">
            <MapPicker
              center={mapCenter}
              zoom={mapZoom}
              selectedFeature={selectedFeature}
              onParcelSelect={handleParcelSelect}
              fullscreen={mapFullscreen}
              onToggleFullscreen={() => setMapFullscreen((v) => !v)}
              lotPolygons={
                lotPolygons.length > 0 && !lotNoPolygon && lotPolygons[0].polygon.length > 0
                  ? [lotPolygons[0]]
                  : undefined
              }
              selectedLotId={null}
              onLotSelect={undefined}
              accessMode={accessMode}
              accessPoint={accessPoint}
              onAccessPointSet={(pt) => { setAccessPoint(pt); setAccessMode(false); }}
              existingBuildings={existingBuildings}
              drawMode={drawMode}
              drawShapeType={drawShapeType}
              drawnShapes={drawnShapes}
              onShapeDrawn={(s) => setDrawnShapes((prev) => [...prev, {
                ...s,
                label: drawShapeType === "batiment" ? NIVEAUX_LABELS[drawNiveaux] : s.label,
                niveaux: drawNiveaux,
              }])}
              onShapeUpdated={(id, polygon, surfaceM2) =>
                setDrawnShapes((prev) =>
                  prev.map((s) => (s.id === id ? { ...s, polygon, surfaceM2 } : s)),
                )
              }
              editMode={editMode}
              overlayPanel={
                <div className="bg-white/95 backdrop-blur-sm border border-gray-200 rounded-xl shadow-lg p-3 space-y-2 w-48 max-h-[400px] overflow-y-auto">
              <p className="text-[11px] font-semibold text-anthracite tracking-wide uppercase">Emprise projet</p>

              {/* Habitable */}
              <div>
                <p className="text-[9px] text-muted uppercase tracking-wide mb-1">Habitable</p>
                <div className="flex gap-1">
                  {([
                    { niv: "rdc" as Niveaux, label: "RDC",  h: HAUTEUR_NIVEAUX.rdc },
                    { niv: "r1"  as Niveaux, label: "R+1",  h: HAUTEUR_NIVEAUX.r1  },
                    { niv: "r2"  as Niveaux, label: "R+2",  h: HAUTEUR_NIVEAUX.r2  },
                  ]).map(({ niv, label, h }) => {
                    const isActive = drawMode && drawShapeType === "batiment" && drawNiveaux === niv;
                    return (
                      <button
                        key={niv}
                        type="button"
                        title={`≈ ${h} m`}
                        onClick={() => {
                          const next = !isActive;
                          setDrawShapeType("batiment");
                          setDrawNiveaux(niv);
                          setDrawMode(next);
                          setEditMode(null);
                          setAccessMode(false);
                        }}
                        className={`flex-1 py-1 text-[10px] font-semibold rounded border transition-colors ${
                          isActive
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-anthracite border-warm-gray hover:border-blue-400 hover:text-blue-600"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Annexes */}
              <div>
                <p className="text-[9px] text-muted uppercase tracking-wide mb-1">Annexes</p>
                <div className="flex flex-wrap gap-1">
                  {([
                    { key: "garage",   label: "Garage"   },
                    { key: "piscine",  label: "Piscine"  },
                    { key: "terrasse", label: "Terrasse" },
                    { key: "autre",    label: "Autre"    },
                  ] as const).map(({ key, label }) => {
                    const isActive = drawMode && drawShapeType === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        title={`≈ ${HAUTEUR_NIVEAUX.annexe} m`}
                        onClick={() => {
                          const next = !isActive;
                          setDrawShapeType(key);
                          setDrawNiveaux("annexe");
                          setDrawMode(next);
                          setEditMode(null);
                          setAccessMode(false);
                        }}
                        className={`px-2 py-0.5 text-[10px] font-medium rounded border transition-colors ${
                          isActive
                            ? `text-white ${SHAPE_SELECTED_CLS[key]}`
                            : "bg-white text-anthracite border-warm-gray hover:border-gray-400"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Outils d'édition */}
              <div className="flex gap-1 pt-0.5 border-t border-warm-gray">
                <button
                  type="button"
                  disabled={drawnShapes.length === 0}
                  onClick={() => { setEditMode((v) => v === "drag" ? null : "drag"); setDrawMode(false); setAccessMode(false); }}
                  className={`flex-1 py-1 text-[10px] font-semibold rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    editMode === "drag"
                      ? "bg-amber-500 text-white border-amber-500"
                      : "bg-white text-anthracite border-warm-gray hover:border-amber-400 hover:text-amber-700"
                  }`}
                  title="Déplacer une surface"
                >✋</button>
                <button
                  type="button"
                  disabled={drawnShapes.length === 0}
                  onClick={() => { setEditMode((v) => v === "rotate" ? null : "rotate"); setDrawMode(false); setAccessMode(false); }}
                  className={`flex-1 py-1 text-[10px] font-semibold rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    editMode === "rotate"
                      ? "bg-amber-500 text-white border-amber-500"
                      : "bg-white text-anthracite border-warm-gray hover:border-amber-400 hover:text-amber-700"
                  }`}
                  title="Tourner une surface"
                >⟲</button>
                <button
                  type="button"
                  disabled={drawnShapes.length === 0}
                  onClick={() => { setEditMode((v) => v === "vertex" ? null : "vertex"); setDrawMode(false); setAccessMode(false); }}
                  className={`flex-1 py-1 text-[10px] font-semibold rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    editMode === "vertex"
                      ? "bg-blue-700 text-white border-blue-700"
                      : "bg-white text-anthracite border-warm-gray hover:border-blue-500 hover:text-blue-700"
                  }`}
                  title="Modifier les dimensions"
                >◈</button>
              </div>

              {/* Liste des formes dessinées */}
              {drawnShapes.length > 0 && (
                <div className="space-y-1 pt-1.5 border-t border-warm-gray max-h-40 overflow-y-auto">
                  {drawnShapes.map((shape) => (
                    <div key={shape.id} className="flex flex-col gap-0.5 text-[10px] bg-gray-50 border border-warm-gray rounded px-2 py-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={`w-2 h-2 rounded-sm shrink-0 ${shape.nonEmprise ? "bg-amber-400" : (shape.niveaux ? NIVEAUX_DOT_CLS[shape.niveaux] : null) ?? SHAPE_DOT_CLS[shape.type] ?? "bg-blue-600"}`} />
                          <span className="text-anthracite truncate">{shape.label}</span>
                          {shape.nonEmprise && (
                            <span className="shrink-0 px-1 py-0 bg-amber-100 text-amber-700 rounded text-[8px] font-semibold">hors emprise</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 ml-1">
                          <span className="font-medium text-anthracite">{shape.surfaceM2} m²</span>
                          <button
                            type="button"
                            onClick={() => setDrawnShapes((prev) => prev.filter((s) => s.id !== shape.id))}
                            className="text-red-400 hover:text-red-600 leading-none font-bold"
                            title="Supprimer"
                          >×</button>
                        </div>
                      </div>
                      {!shape.nonEmprise && shape.niveaux && shape.niveaux !== "annexe" && (
                        <div className="flex items-center gap-1 pl-3.5">
                          {(["rdc", "r1", "r2"] as Niveaux[]).map((niv) => (
                            <button
                              key={niv}
                              type="button"
                              onClick={() => setDrawnShapes((prev) =>
                                prev.map((s) => s.id === shape.id ? { ...s, niveaux: niv, label: NIVEAUX_LABELS[niv] } : s)
                              )}
                              className={`px-1.5 py-0 text-[9px] font-semibold rounded border transition-colors ${
                                shape.niveaux === niv
                                  ? "bg-slate-700 text-white border-slate-700"
                                  : "bg-white text-muted border-warm-gray hover:border-slate-400"
                              }`}
                              title={`≈ ${HAUTEUR_NIVEAUX[niv]} m`}
                            >
                              {NIVEAUX_LABELS[niv]}
                            </button>
                          ))}
                          <span className="text-[9px] text-muted ml-0.5">≈ {HAUTEUR_NIVEAUX[shape.niveaux]} m</span>
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="flex justify-between text-[10px] font-semibold pt-1 border-t border-warm-gray">
                    <span className="text-anthracite">Total projet</span>
                    <span>{drawnShapes.filter((sh) => !sh.nonEmprise).reduce((s, sh) => s + sh.surfaceM2, 0)} m²</span>
                  </div>
                </div>
              )}

              {/* ── Bilan de surface automatique ── */}
              {parcel && (() => {
                const existM2 = existingBuildings.reduce((s, b) => s + b.footprintM2, 0);
                const projetM2 = drawnShapes.filter((sh) => !sh.nonEmprise).reduce((s, sh) => s + sh.surfaceM2, 0);
                // Emprise au sol = RDC uniquement (R+1/R+2 ne créent pas de nouveau footprint)
                const empriseRdcM2 = drawnShapes.reduce((s, sh) => {
                  if (sh.nonEmprise) return s;
                  if (sh.niveaux !== "r1" && sh.niveaux !== "r2") return s + sh.surfaceM2;
                  return s + calcUpperFloorUncoveredM2(sh, existingBuildings, drawnShapes);
                }, 0);
                const totalM2 = existM2 + empriseRdcM2;
                const libresM2 = Math.max(0, parcel.surface - totalM2);
                const empriseP = Math.round(totalM2 / parcel.surface * 100);
                const libresP = Math.round(libresM2 / parcel.surface * 100);
                const maxP = aiAnalysis?.empriseNonReglementee ? null : (aiAnalysis?.empriseMax ?? null);
                const overMax = maxP !== null && empriseP > maxP;
                return (
                  <div className="pt-2 border-t border-warm-gray space-y-1">
                    <p className="text-[10px] font-semibold text-anthracite tracking-wide uppercase mb-1.5">Bilan de surface</p>
                    {existM2 > 0 && (
                      <div className="flex justify-between text-[10px]">
                        <span className="text-muted">Existant</span>
                        <span className="text-anthracite font-medium">{existM2} m²</span>
                      </div>
                    )}
                    {projetM2 > 0 && (
                      <div className="flex justify-between text-[10px]">
                        <span className="text-muted">Projet dessiné</span>
                        <span className="text-anthracite font-medium">{projetM2} m²</span>
                      </div>
                    )}
                    <div className={`flex justify-between text-[10px] font-semibold rounded px-1.5 py-1 ${overMax ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"}`}>
                      <span>Emprise totale</span>
                      <span>{totalM2} m² · {empriseP}%{maxP !== null ? ` / ${maxP}%` : ""}</span>
                    </div>
                    <div className="flex justify-between text-[10px] font-semibold bg-green-50 rounded px-1.5 py-1 text-green-800">
                      <span>Espaces libres</span>
                      <span>{libresM2} m² · {libresP}%</span>
                    </div>
                    <div className="flex justify-between text-[10px] text-muted">
                      <span>Imperméabilisé ≈</span>
                      <span>{totalM2} m²</span>
                    </div>
                  </div>
                );
              })()}

              {/* ── Alertes temps réel ── */}
              {aiAnalysis && parcel && drawnShapes.length > 0 && (() => {
                const drawnM2 = drawnShapes.reduce((s, sh) => {
                  if (sh.nonEmprise) return s;
                  if (sh.niveaux !== "r1" && sh.niveaux !== "r2") return s + sh.surfaceM2;
                  return s + calcUpperFloorUncoveredM2(sh, existingBuildings, drawnShapes);
                }, 0);
                const existM2 = existingBuildings.reduce((s, b) => s + b.footprintM2, 0);
                const totalM2 = drawnM2 + existM2;
                const empriseRatio = Math.round(totalM2 / parcel.surface * 100);
                const overEmprise = !aiAnalysis.empriseNonReglementee && aiAnalysis.empriseMax > 0 && empriseRatio > aiAnalysis.empriseMax;

                // Distance minimale réelle des formes dessinées au périmètre de la parcelle
                const parcelRingCoords = (() => {
                  const g = selectedFeature?.geometry;
                  if (!g) return null;
                  if (g.type === "Polygon") return (g.coordinates as [number, number][][])[0];
                  if (g.type === "MultiPolygon") return (g.coordinates as [number, number][][][])[0][0];
                  return null;
                })();
                const mainShapesStep3 = drawnShapes.filter((sh) => !sh.nonEmprise);

                const getRetraitRule = (sh: DrawnShape) => {
                  if (sh.niveaux !== "annexe") return { retraitLateral: aiAnalysis.retraitLateral, enLimite: false, note: undefined as string | undefined };
                  const r = aiAnalysis.annexeRetraits?.find((r) => r.type === sh.type);
                  return r ?? { retraitLateral: aiAnalysis.retraitLateral, enLimite: false, note: undefined };
                };

                return (
                  <div className="pt-1.5 border-t border-warm-gray space-y-1">
                    {/* Emprise au sol */}
                    {!aiAnalysis.empriseNonReglementee && aiAnalysis.empriseMax > 0 && (
                      overEmprise ? (
                        <div className="flex items-start gap-1.5 bg-red-50 border border-red-200 rounded px-2 py-1.5 text-[10px] text-red-800">
                          <span className="shrink-0 font-bold">!</span>
                          <span>Emprise : <strong>{empriseRatio}%</strong> &gt; {aiAnalysis.empriseMax}% max</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 bg-green-50 border border-green-200 rounded px-2 py-1.5 text-[10px] text-green-800">
                          <span>✓</span>
                          <span>Emprise : {empriseRatio}% / {aiAnalysis.empriseMax}% max</span>
                        </div>
                      )
                    )}
                    {/* Retrait par forme */}
                    {parcelRingCoords && mainShapesStep3.map((sh) => {
                      const rule = getRetraitRule(sh);
                      if (rule.enLimite) return (
                        <div key={sh.id} className="flex items-center gap-1.5 bg-green-50 border border-green-200 rounded px-2 py-1.5 text-[10px] text-green-800">
                          <span>✓</span>
                          <span>{sh.label} — limite autorisée{rule.note ? ` (${rule.note})` : ""}</span>
                        </div>
                      );
                      if (rule.retraitLateral <= 0) return null;
                      const dist = minDistToRing(sh.polygon, parcelRingCoords);
                      const ok = dist >= rule.retraitLateral - 0.05;
                      return ok ? (
                        <div key={sh.id} className="flex items-center gap-1.5 bg-green-50 border border-green-200 rounded px-2 py-1.5 text-[10px] text-green-800">
                          <span>✓</span>
                          <span>{sh.label} — {dist.toFixed(1)} m ≥ {rule.retraitLateral} m</span>
                        </div>
                      ) : (
                        <div key={sh.id} className="flex items-start gap-1.5 bg-red-50 border border-red-200 rounded px-2 py-1.5 text-[10px] text-red-800">
                          <span className="shrink-0 font-bold">!</span>
                          <span>{sh.label} — <strong>{dist.toFixed(1)} m</strong> &lt; {rule.retraitLateral} m min{rule.note ? ` (${rule.note})` : ""}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* ── Parking non clos (généré automatiquement après analyse) ── */}
              {drawnShapes.some((s) => s.nonEmprise) && (
                <div className="pt-1.5 border-t border-warm-gray">
                  <p className="text-[9px] text-muted italic">🅿 Parking non clos généré — hors emprise au sol</p>
                </div>
              )}

                </div>
              }
              zoneConstructible={showZoneConstructible && aiAnalysis ? {
                rv: aiAnalysis.retraitVoie,
                rl: aiAnalysis.retraitLateral,
                rf: aiAnalysis.retraitFond,
                hasAnnexes: (aiAnalysis.annexesEnLimite?.length ?? 0) > 0,
                annexeRetraits: aiAnalysis.annexeRetraits,
              } : null}
            />
          </div>

          {/* Bouton zones constructibles — sous la carte, hors overlayPanel */}
          {aiAnalysis && (
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => setShowZoneConstructible((v) => !v)}
                className={`text-xs font-semibold tracking-[0.12em] uppercase px-4 py-1.5 border transition-colors ${
                  showZoneConstructible
                    ? "bg-emerald-700 text-white border-emerald-700"
                    : "bg-white text-anthracite border-warm-gray hover:border-emerald-500 hover:text-emerald-700"
                }`}
              >
                {showZoneConstructible ? "◉ Masquer les zones" : "◎ Zones constructibles"}
              </button>
            </div>
          )}

          {/* CPAP section pour lotissement */}
          {isLotissement && projectType && (
            <div className="border border-indigo-200 bg-indigo-50/40 p-4 space-y-3">
              <div>
                <p className="text-sm font-medium text-indigo-900">CPAP du lotissement</p>
                <p className="text-[11px] text-indigo-700 mt-0.5 leading-relaxed">
                  L&apos;IA lira le CPAP et le règlement PLU simultanément pour retenir les règles les plus restrictives.
                </p>
              </div>
              <label className="flex flex-col items-center justify-center gap-1.5 w-full h-20 border-2 border-dashed border-indigo-300 bg-white cursor-pointer hover:border-indigo-500 transition-colors px-4 text-center">
                <input type="file" accept=".pdf,image/*" className="hidden"
                  onChange={(e) => setCpapFile(e.target.files?.[0] ?? null)} />
                <p className="text-xs font-medium text-indigo-900">Cahier des Prescriptions Architecturales et Paysagères</p>
                {cpapFile
                  ? <p className="text-[10px] text-indigo-600 font-medium truncate max-w-full">{cpapFile.name}</p>
                  : <p className="text-[10px] text-indigo-500">PDF — requis pour l&apos;analyse lotissement</p>}
              </label>
            </div>
          )}

          {analyzeError && (
            <div className="border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] text-amber-800 flex items-center justify-between gap-3">
              <span>
                {analyzeOverloaded
                  ? "⚠ Serveur IA surchargé — réessayez dans quelques secondes."
                  : "⚠ L'IA n'a pas pu lire le PLU. Les règles devront être saisies manuellement à l'étape Bilan."}
              </span>
              <button
                type="button"
                disabled={analyzing}
                onClick={handleAnalyze}
                className="shrink-0 text-[10px] font-semibold border border-amber-400 bg-amber-100 hover:bg-amber-200 text-amber-900 px-2.5 py-1 transition-colors disabled:opacity-50"
              >
                Réessayer
              </button>
            </div>
          )}
          {aiAnalysis && (
            <div className="border border-warm-gray bg-warm-gray/10 divide-y divide-warm-gray">
              {/* En-tête */}
              <div className="px-4 py-2.5 flex items-center gap-2">
                <span className="text-[9px] font-bold tracking-[0.15em] uppercase bg-terracotta/10 text-terracotta border border-terracotta/20 px-1.5 py-0.5 shrink-0">IA</span>
                <p className="text-[10px] font-medium tracking-[0.1em] uppercase text-muted">
                  Zone {zone?.libelle ?? "?"}{cpapFileZac ? " · PLU + CPAP analysés" : " · PLU analysé"}
                  {aiAnalysis.sourcePluOfficiel && <span className="ml-2 text-emerald-600">— source officielle</span>}
                </p>
              </div>

              {/* Règles numériques */}
              <div className="px-4 py-3">
                <div className="grid grid-cols-5 gap-2">
                  {[
                    { label: "Retrait voie", v: `${aiAnalysis.retraitVoie} m` },
                    { label: "Retrait latéral", v: `${aiAnalysis.retraitLateral} m` },
                    { label: "Retrait fond", v: `${aiAnalysis.retraitFond} m` },
                    { label: "Emprise max", v: aiAnalysis.empriseNonReglementee ? "Non régl." : `${aiAnalysis.empriseMax}%` },
                    { label: "Hauteur max", v: `${aiAnalysis.hauteurMax} m` },
                  ].map((r) => (
                    <div key={r.label} className="border border-warm-gray bg-white p-2 text-center">
                      <p className="text-sm font-semibold text-anthracite">{r.v}</p>
                      <p className="text-[10px] text-muted mt-0.5 leading-tight">{r.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Règles spécifiques annexes */}
              {(aiAnalysis.annexeRetraits ?? []).some((r) => r.surfaceMaxM2 != null || r.hauteurMaxM != null) && (
                <div className="px-4 pb-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1.5">Limites par type d&apos;annexe</p>
                  <div className="flex flex-wrap gap-2">
                    {(aiAnalysis.annexeRetraits ?? [])
                      .filter((r) => r.surfaceMaxM2 != null || r.hauteurMaxM != null)
                      .map((r) => (
                        <div key={r.type} className="border border-warm-gray bg-white px-3 py-1.5 text-[11px]">
                          <span className="font-semibold text-anthracite capitalize">{r.type}</span>
                          {r.surfaceMaxM2 != null && <span className="text-muted ml-2">max {r.surfaceMaxM2} m²</span>}
                          {r.hauteurMaxM != null && <span className="text-muted ml-2">H ≤ {r.hauteurMaxM} m</span>}
                          {r.enLimite && <span className="text-[#0891b2] ml-2">en limite ✓</span>}
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Bilan de surface détaillé */}
              {parcel && (() => {
                const existM2 = existingBuildings.reduce((s, b) => s + b.footprintM2, 0);
                const projetM2 = drawnShapes.filter((sh) => !sh.nonEmprise).reduce((s, sh) => s + sh.surfaceM2, 0);
                // Emprise au sol = RDC uniquement (R+1/R+2 = surélévation, pas de footprint supplémentaire)
                const empriseRdcM2 = drawnShapes.reduce((s, sh) => {
                  if (sh.nonEmprise) return s;
                  if (sh.niveaux !== "r1" && sh.niveaux !== "r2") return s + sh.surfaceM2;
                  return s + calcUpperFloorUncoveredM2(sh, existingBuildings, drawnShapes);
                }, 0);
                const totalM2 = existM2 + empriseRdcM2;
                const libresM2 = Math.max(0, parcel.surface - totalM2);
                const empriseP = Math.round(totalM2 / parcel.surface * 100);
                const libresP = Math.round(libresM2 / parcel.surface * 100);
                const maxP = aiAnalysis.empriseNonReglementee ? null : aiAnalysis.empriseMax;
                const overMax = maxP !== null && empriseP > maxP;
                const libresMinP = aiAnalysis.espacesLibresPct ?? 0;
                const libresOk = libresMinP === 0 || libresP >= libresMinP;
                return (
                  <div className="px-4 py-3 space-y-2">
                    <p className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted mb-2">Bilan de surface — {parcel.surface} m² total</p>
                    <div className="grid grid-cols-2 gap-2">
                      {existM2 > 0 && (
                        <div className="border border-warm-gray bg-white p-3">
                          <p className="text-base font-bold text-anthracite">{existM2} m²</p>
                          <p className="text-[10px] text-muted mt-0.5">Emprise existante</p>
                          <p className="text-[10px] text-muted">{Math.round(existM2 / parcel.surface * 100)}% de la parcelle</p>
                        </div>
                      )}
                      {projetM2 > 0 && (
                        <div className="border border-warm-gray bg-white p-3">
                          <p className="text-base font-bold text-anthracite">{projetM2} m²</p>
                          <p className="text-[10px] text-muted mt-0.5">Emprise dessinée</p>
                          <p className="text-[10px] text-muted">{Math.round(projetM2 / parcel.surface * 100)}% de la parcelle</p>
                        </div>
                      )}
                      <div className={`border p-3 ${overMax ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
                        <p className={`text-base font-bold ${overMax ? "text-red-700" : "text-amber-800"}`}>{totalM2} m² · {empriseP}%</p>
                        <p className={`text-[10px] mt-0.5 ${overMax ? "text-red-600" : "text-amber-700"}`}>Emprise totale imperméabilisée</p>
                        {maxP !== null && <p className={`text-[10px] font-medium ${overMax ? "text-red-700" : "text-amber-700"}`}>Max autorisé : {maxP}%{overMax ? " — dépassé" : " — OK"}</p>}
                      </div>
                      <div className={`border p-3 ${libresOk ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}>
                        <p className={`text-base font-bold ${libresOk ? "text-green-700" : "text-amber-800"}`}>{libresM2} m² · {libresP}%</p>
                        <p className={`text-[10px] mt-0.5 ${libresOk ? "text-green-600" : "text-amber-700"}`}>Espaces libres non imperméabilisés</p>
                        {libresMinP > 0 && <p className={`text-[10px] font-medium ${libresOk ? "text-green-700" : "text-amber-700"}`}>Min requis : {libresMinP}%{libresOk ? " — OK" : " — insuffisant"}</p>}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Résumé */}
              {aiAnalysis.resume && (
                <div className="px-4 py-3">
                  <p className="text-[11px] text-anthracite/80 leading-relaxed">{aiAnalysis.resume}</p>
                </div>
              )}

              {/* Points d'attention */}
              {aiAnalysis.pointsAttention && aiAnalysis.pointsAttention.length > 0 && (
                <div className="px-4 py-3 space-y-1">
                  {aiAnalysis.pointsAttention.map((pt, i) => (
                    <div key={i} className="flex items-start gap-2 text-[11px] text-amber-800">
                      <span className="shrink-0 mt-0.5">⚠</span>
                      <span>{pt}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3 flex-wrap">
            <button type="button" onClick={() => { setDrawMode(false); setEditMode(null); setStep(2); }}
              className="border border-warm-gray text-anthracite text-xs font-semibold tracking-[0.2em] uppercase px-6 py-3 hover:bg-warm-gray/40 transition-colors">
              ← Retour
            </button>
            <button type="button" onClick={() => { setDrawMode(false); setEditMode(null); setStep(4); }}
              className="bg-terracotta text-white text-xs font-semibold tracking-[0.2em] uppercase px-8 py-3 hover:bg-terracotta-dark transition-colors">
              Analyser →
            </button>
          </div>
        </div>
      )}

      {/* ── ÉTAPE 4 ── */}
      {step === 4 && parcel ? (() => {
        // Calculs surface (parking non clos exclu de l'emprise)
        const existM2 = existingBuildings.reduce((s, b) => s + b.footprintM2, 0);
        const projetM2 = drawnShapes.filter((sh) => !sh.nonEmprise).reduce((s, sh) => s + sh.surfaceM2, 0);
        // Emprise au sol = RDC uniquement (R+1/R+2 = surélévation, footprint inchangé)
        const empriseRdcM2 = drawnShapes.reduce((s, sh) => {
          if (sh.nonEmprise) return s;
          if (sh.niveaux !== "r1" && sh.niveaux !== "r2") return s + sh.surfaceM2;
          return s + calcUpperFloorUncoveredM2(sh, existingBuildings, drawnShapes);
        }, 0);
        const totalM2 = existM2 + empriseRdcM2;
        const libresM2 = Math.max(0, parcel.surface - totalM2);
        const empriseP = Math.round(totalM2 / parcel.surface * 100);
        const libresP = Math.round(libresM2 / parcel.surface * 100);

        // Retrait min mesuré
        const parcelRingCoords4 = (() => {
          const g = selectedFeature?.geometry;
          if (!g) return null;
          if (g.type === "Polygon") return (g.coordinates as [number, number][][])[0];
          if (g.type === "MultiPolygon") return (g.coordinates as [number, number][][][])[0][0];
          return null;
        })();
        const mainShapes4 = drawnShapes.filter((sh) => !sh.nonEmprise);
        // H/2 ne s'applique qu'aux bâtiments principaux — exclure les annexes en limite (0 m)
        const mainHabitableShapes4 = mainShapes4.filter((sh) => sh.niveaux && sh.niveaux !== "annexe");
        const minRetraitMesure = parcelRingCoords4 && mainHabitableShapes4.length > 0
          ? Math.min(...mainHabitableShapes4.map((sh) => minDistToRing(sh.polygon, parcelRingCoords4)))
          : null;

        // Checks PLU
        type Status = "ok" | "nok" | "warn";
        const checks: { label: string; status: Status; main: string; sub?: string; ref?: string }[] = [];

        if (aiAnalysis) {
          // Zone
          const zoneChar = zone?.libelle?.[0] ?? "U";
          const zoneOk = !["A", "N"].includes(zoneChar);
          checks.push({ label: "Zone PLU", status: zoneOk ? "ok" : "nok",
            main: `Zone ${zone?.libelle ?? "?"} — ${zoneOk ? "Constructible" : "Construction limitée"}`,
            ref: aiAnalysis.sourcePluOfficiel ? "PLU officiel lu" : "Estimation IA" });

          // Emprise
          if (aiAnalysis.empriseNonReglementee) {
            checks.push({ label: "Emprise au sol", status: "ok", main: "Non réglementée", sub: `${empriseP}% utilisé — ${totalM2} m²`, ref: "Aucune limite" });
          } else {
            const ok = empriseP <= aiAnalysis.empriseMax;
            checks.push({ label: "Emprise au sol", status: ok ? "ok" : "nok",
              main: ok ? `${empriseP}% ≤ ${aiAnalysis.empriseMax}% max ✓` : `${empriseP}% > ${aiAnalysis.empriseMax}% max`,
              sub: `${totalM2} m² imperméabilisés`, ref: `Max ${aiAnalysis.empriseMax}%` });
          }

          // Espaces libres
          const libresMinP = aiAnalysis.espacesLibresPct ?? 0;
          if (libresMinP > 0) {
            const ok = libresP >= libresMinP;
            checks.push({ label: "Espaces libres", status: ok ? "ok" : "nok",
              main: ok ? `${libresP}% ≥ ${libresMinP}% min ✓` : `${libresP}% < ${libresMinP}% min`,
              sub: `${libresM2} m² non imperméabilisés`, ref: `Min ${libresMinP}% plantés` });
          } else {
            checks.push({ label: "Espaces libres", status: "ok", main: `${libresP}% libres (${libresM2} m²)`, ref: "Non réglementé" });
          }

          // Retrait par forme
          if (parcelRingCoords4 && mainShapes4.length > 0) {
            const getRetraitRule4 = (sh: DrawnShape) => {
              if (sh.niveaux !== "annexe") return { retraitLateral: aiAnalysis.retraitLateral, enLimite: false, note: undefined as string | undefined };
              const r = aiAnalysis.annexeRetraits?.find((r) => r.type === sh.type);
              return r ?? { retraitLateral: aiAnalysis.retraitLateral, enLimite: false, note: undefined };
            };
            for (const sh of mainShapes4) {
              const rule = getRetraitRule4(sh);
              if (rule.enLimite) {
                checks.push({ label: `Retrait — ${sh.label}`, status: "ok",
                  main: `Limite séparative autorisée${rule.note ? ` — ${rule.note}` : ""}`,
                  ref: "PLU" });
              } else if (rule.retraitLateral > 0) {
                const dist = minDistToRing(sh.polygon, parcelRingCoords4);
                const rOk = dist >= rule.retraitLateral - 0.05;
                checks.push({ label: `Retrait — ${sh.label}`, status: rOk ? "ok" : "nok",
                  main: rOk ? `${dist.toFixed(1)} m ≥ ${rule.retraitLateral} m min ✓` : `${dist.toFixed(1)} m < ${rule.retraitLateral} m min`,
                  sub: rule.note,
                  ref: `Min ${rule.retraitLateral} m` });
              }
            }
          }
          if (mainShapes4.length === 0) {
            checks.push({ label: "Retrait limites sépar.", status: "warn",
              main: `Min ${aiAnalysis.retraitLateral} m requis`, sub: "Dessinez vos surfaces pour mesurer", ref: `Min ${aiAnalysis.retraitLateral} m` });
          }

          // Retrait voie
          checks.push({ label: "Retrait voie publique", status: "warn",
            main: `Min ${aiAnalysis.retraitVoie} m requis`, sub: "Vérifier sur les cotes", ref: `Min ${aiAnalysis.retraitVoie} m` });

          // Retrait fond
          checks.push({ label: "Retrait fond parcelle", status: "warn",
            main: `Min ${aiAnalysis.retraitFond} m requis`, sub: "Vérifier sur les cotes", ref: `Min ${aiAnalysis.retraitFond} m` });

          // Hauteur
          {
            const shapesWithNiv = drawnShapes.filter((s) => s.niveaux && s.niveaux !== "annexe");
            if (shapesWithNiv.length > 0) {
              const maxHauteur = Math.max(...shapesWithNiv.map((s) => HAUTEUR_NIVEAUX[s.niveaux!]));
              const hOk = maxHauteur <= aiAnalysis.hauteurMax;
              checks.push({ label: "Hauteur maximale", status: hOk ? "ok" : "nok",
                main: hOk
                  ? `${maxHauteur} m ≤ ${aiAnalysis.hauteurMax} m max ✓`
                  : `${maxHauteur} m > ${aiAnalysis.hauteurMax} m max`,
                sub: shapesWithNiv.map((s) => `${s.label} : ${NIVEAUX_LABELS[s.niveaux!]} ≈ ${HAUTEUR_NIVEAUX[s.niveaux!]} m`).join(" · "),
                ref: `Max ${aiAnalysis.hauteurMax} m` });
              // Règle H/2 : retrait ≥ H/2
              if (minRetraitMesure !== null) {
                const demiH = maxHauteur / 2;
                const hHalfOk = minRetraitMesure >= demiH - 0.05;
                checks.push({ label: "Règle H/2", status: hHalfOk ? "ok" : "nok",
                  main: hHalfOk
                    ? `${minRetraitMesure.toFixed(1)} m ≥ H/2 (${demiH.toFixed(1)} m) ✓`
                    : `${minRetraitMesure.toFixed(1)} m < H/2 (${demiH.toFixed(1)} m)`,
                  sub: `Hauteur estimée : ${maxHauteur} m`,
                  ref: `Retrait min = H/2 = ${demiH.toFixed(1)} m` });
              } else {
                const demiH = maxHauteur / 2;
                checks.push({ label: "Règle H/2", status: "warn",
                  main: `Retrait min requis ≥ ${demiH.toFixed(1)} m (H/2)`,
                  sub: "Activez les cotes pour mesurer",
                  ref: `H/2 = ${demiH.toFixed(1)} m` });
              }
            } else {
              checks.push({ label: "Hauteur maximale", status: "warn",
                main: `Max ${aiAnalysis.hauteurMax} m`, sub: "Définissez le niveau des formes dessinées", ref: `Max ${aiAnalysis.hauteurMax} m` });
            }
          }

          // Parking
          if (aiAnalysis.parkingNombrePlaces === 0) {
            checks.push({ label: "Stationnement", status: "ok", main: "Aucune place requise", ref: "Non applicable" });
          } else {
            const nonCloseStr = (aiAnalysis.parkingNonClose ?? 0) > 0
              ? ` dont ${aiAnalysis.parkingNonClose} non close${(aiAnalysis.parkingNonClose ?? 0) > 1 ? "s" : ""}`
              : "";
            checks.push({ label: "Stationnement", status: "warn",
              main: `${aiAnalysis.parkingNombrePlaces} place${aiAnalysis.parkingNombrePlaces > 1 ? "s" : ""}${nonCloseStr}`,
              sub: aiAnalysis.parkingOuvertSurVoirie ? "Accès direct voirie requis" : undefined,
              ref: "À prévoir sur la parcelle" });
          }
        }

        // Score
        const scoreOk = checks.filter((c) => c.status === "ok").length;
        const scoreNok = checks.filter((c) => c.status === "nok").length;
        const scoreTotal = checks.filter((c) => c.status !== "warn").length;
        const scorePct = scoreTotal > 0 ? Math.round(scoreOk / scoreTotal * 100) : 50;
        const scoreLabel = scorePct >= 80 ? "Favorable" : scorePct >= 50 ? "Sous conditions" : "Complexe";
        const scoreBarCls = scorePct >= 80 ? "bg-emerald-500" : scorePct >= 50 ? "bg-amber-500" : "bg-red-500";
        const scoreTextCls = scorePct >= 80 ? "text-emerald-700" : scorePct >= 50 ? "text-amber-700" : "text-red-700";

        return (
          <div className="space-y-5">
            {/* Titre */}
            <div>
              <h2 className="text-xl font-light text-anthracite mb-1">Bilan de faisabilité — {parcel.ref}</h2>
              <p className="text-sm text-muted">Résultat de l&apos;analyse PLU · {PROJECT_TYPES.find((p) => p.key === projectType)?.label}</p>
            </div>

            {/* Carte lecture seule */}
            <div>
              <MapPicker
                center={mapCenter}
                zoom={mapZoom}
                selectedFeature={selectedFeature}
                onParcelSelect={() => {}}
                fullscreen={mapFullscreen}
                onToggleFullscreen={() => setMapFullscreen((v) => !v)}
                lotPolygons={
                  lotPolygons.length > 0 && !lotNoPolygon && lotPolygons[0].polygon.length > 0
                    ? [lotPolygons[0]]
                    : undefined
                }
                selectedLotId={null}
                onLotSelect={undefined}
                accessPoint={accessPoint}
                onAccessPointSet={() => {}}
                existingBuildings={existingBuildings}
                readOnlyShapes={drawnShapes}
                showReadOnlyCotes={showCotesStep4}
                measureMode={measureMode}
                manualMeasures={manualMeasures}
                onAddManualMeasure={(m) => setManualMeasures((prev) => [...prev, m])}
                zoneConstructible={showZoneConstructible && aiAnalysis ? {
                  rv: aiAnalysis.retraitVoie,
                  rl: aiAnalysis.retraitLateral,
                  rf: aiAnalysis.retraitFond,
                  hasAnnexes: (aiAnalysis.annexesEnLimite?.length ?? 0) > 0,
                  annexeRetraits: aiAnalysis.annexeRetraits,
                } : null}
              />
              <div className="mt-2 flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={() => setShowCotesStep4((v) => !v)}
                  className={`text-xs font-semibold tracking-[0.12em] uppercase px-4 py-1.5 border transition-colors ${
                    showCotesStep4
                      ? "bg-blue-700 text-white border-blue-700"
                      : "bg-white text-anthracite border-warm-gray hover:border-blue-400 hover:text-blue-700"
                  }`}
                >
                  {showCotesStep4 ? "◉ Masquer les cotes" : "◎ Afficher les cotes"}
                </button>
                {aiAnalysis && (
                  <button
                    type="button"
                    onClick={() => setShowZoneConstructible((v) => !v)}
                    className={`text-xs font-semibold tracking-[0.12em] uppercase px-4 py-1.5 border transition-colors ${
                      showZoneConstructible
                        ? "bg-emerald-700 text-white border-emerald-700"
                        : "bg-white text-anthracite border-warm-gray hover:border-emerald-500 hover:text-emerald-700"
                    }`}
                  >
                    {showZoneConstructible ? "◉ Masquer les zones" : "◎ Zones constructibles"}
                  </button>
                )}
                {aiAnalysis && (
                  <span className={`text-[9px] font-semibold tracking-[0.1em] uppercase px-2 py-0.5 border ${
                    aiAnalysis.sourcePluOfficiel
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-amber-50 text-amber-700 border-amber-200"
                  }`}>
                    {aiAnalysis.sourcePluOfficiel ? "PLU officiel lu" : "Estimation IA"}
                  </span>
                )}
              </div>

              {/* Panneau mesures manuelles */}
              <div className="mt-2 border border-warm-gray bg-white">
                <div className="flex items-center justify-between px-3 py-2 border-b border-warm-gray/60">
                  <p className="text-[10px] font-semibold tracking-[0.15em] uppercase text-anthracite">Cotes manuelles</p>
                  <div className="flex items-center gap-2">
                    {manualMeasures.length > 0 && (
                      <button type="button"
                        onClick={() => { setManualMeasures([]); setMeasureMode(false); }}
                        className="text-[9px] text-muted hover:text-red-600 underline">
                        Tout effacer
                      </button>
                    )}
                    <button type="button"
                      onClick={() => setMeasureMode((v) => !v)}
                      className={`text-xs font-semibold tracking-[0.12em] uppercase px-3 py-1 border transition-colors ${
                        measureMode
                          ? "bg-violet-700 text-white border-violet-700"
                          : "bg-white text-anthracite border-warm-gray hover:border-violet-400 hover:text-violet-700"
                      }`}>
                      {measureMode ? "◉ En cours…" : "◎ Mesurer"}
                    </button>
                  </div>
                </div>
                {measureMode && (
                  <p className="text-[10px] text-violet-700 px-3 py-1.5 bg-violet-50 border-b border-violet-100">
                    Cliquez un 1er point, puis un 2e — perpendiculaire à la limite si vous cliquez près d&apos;un bord.
                  </p>
                )}
                {manualMeasures.length > 0 ? (
                  <ul className="divide-y divide-warm-gray/40">
                    {manualMeasures.map((m, i) => (
                      <li key={m.id} className="flex items-center justify-between px-3 py-1.5">
                        <span className="text-xs text-anthracite">
                          Cote {i + 1} —{" "}
                          <span className="font-semibold text-violet-700">
                            {m.dist < 10 ? m.dist.toFixed(2) : m.dist.toFixed(1)} m
                          </span>
                        </span>
                        <button type="button"
                          onClick={() => setManualMeasures((prev) => prev.filter((x) => x.id !== m.id))}
                          className="text-[11px] text-muted hover:text-red-600 px-1 leading-none">
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : !measureMode && (
                  <p className="text-[10px] text-muted px-3 py-2 italic">Aucune cote ajoutée</p>
                )}
              </div>
            </div>

            {/* Bilan surface — 4 tuiles */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {existM2 > 0 && (
                <div className="border border-warm-gray bg-white p-3">
                  <p className="text-sm font-bold text-anthracite">{existM2} m²</p>
                  <p className="text-[10px] text-muted mt-0.5">Existant</p>
                  <p className="text-[10px] text-muted">{Math.round(existM2 / parcel.surface * 100)}% parcelle</p>
                  <div className="mt-1 space-y-0.5">
                    {existingBuildings.map((b, i) => (
                      <div key={i} className="flex items-center gap-1 text-[9px] text-muted">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-amber-500" />
                        <span className="truncate">{b.usage ?? "Bâtiment"} {b.footprintM2} m²</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {drawnShapes.length > 0 && (
                <div className="border border-warm-gray bg-white p-3">
                  <p className="text-sm font-bold text-anthracite">{projetM2} m²</p>
                  <p className="text-[10px] text-muted mt-0.5">Projet dessiné</p>
                  <div className="mt-1 space-y-0.5">
                    {drawnShapes.map((s) => (
                      <div key={s.id} className="flex items-center gap-1 text-[9px] text-muted">
                        <span className={`w-1.5 h-1.5 rounded-sm shrink-0 ${(s.niveaux ? NIVEAUX_DOT_CLS[s.niveaux] : null) ?? SHAPE_DOT_CLS[s.type] ?? "bg-blue-600"}`} />
                        <span className="truncate">{s.label} {s.surfaceM2} m²</span>
                        {s.niveaux && (
                          <span className="ml-auto shrink-0 px-1 py-0 bg-slate-100 text-slate-600 rounded text-[8px] font-semibold">
                            {NIVEAUX_LABELS[s.niveaux]} ≈ {HAUTEUR_NIVEAUX[s.niveaux]} m
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  {(() => {
                    const shapesWithNiv = drawnShapes.filter((s) => s.niveaux && s.niveaux !== "annexe");
                    if (shapesWithNiv.length === 0) return null;
                    const maxH = Math.max(...shapesWithNiv.map((s) => HAUTEUR_NIVEAUX[s.niveaux!]));
                    const pluMaxH = aiAnalysis?.hauteurMax;
                    const hOk = pluMaxH ? maxH <= pluMaxH : true;
                    return (
                      <div className={`mt-1.5 px-1.5 py-1 rounded text-[9px] font-semibold ${hOk ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                        Hauteur max estimée : {maxH} m{pluMaxH ? ` / ${pluMaxH} m autorisé` : ""}
                      </div>
                    );
                  })()}
                </div>
              )}
              <div className={`border p-3 ${empriseP > (aiAnalysis?.empriseMax ?? 100) && !aiAnalysis?.empriseNonReglementee ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
                <p className={`text-sm font-bold ${empriseP > (aiAnalysis?.empriseMax ?? 100) && !aiAnalysis?.empriseNonReglementee ? "text-red-700" : "text-amber-800"}`}>
                  {totalM2} m² · {empriseP}%
                </p>
                <p className="text-[10px] text-amber-700 mt-0.5">Emprise totale</p>
                {!aiAnalysis?.empriseNonReglementee && aiAnalysis?.empriseMax && (
                  <p className="text-[10px] text-amber-700">Max {aiAnalysis.empriseMax}%</p>
                )}
              </div>
              <div className="border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-sm font-bold text-emerald-700">{libresM2} m² · {libresP}%</p>
                <p className="text-[10px] text-emerald-600 mt-0.5">Espaces libres</p>
                {(aiAnalysis?.espacesLibresPct ?? 0) > 0 && (
                  <p className="text-[10px] text-emerald-600">Min {aiAnalysis!.espacesLibresPct}%</p>
                )}
              </div>
            </div>

            {/* Checklist PLU */}
            {aiAnalysis && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold tracking-[0.15em] uppercase text-anthracite">Points de conformité PLU</p>
                  <p className={`text-xs font-bold ${scoreTextCls}`}>{scoreOk}/{scoreTotal} validés — {scoreLabel}</p>
                </div>

                {/* Barre score */}
                <div className="flex gap-0.5">
                  {Array.from({ length: 10 }, (_, i) => (
                    <div key={i} className={`flex-1 h-1.5 rounded-full ${i < Math.round(scorePct / 10) ? scoreBarCls : "bg-gray-200"}`} />
                  ))}
                </div>

                {/* Grille checks */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {checks.map((c, i) => {
                    const iconCls = c.status === "ok" ? "bg-emerald-500" : c.status === "nok" ? "bg-red-500" : "bg-gray-400";
                    const cardCls = c.status === "ok" ? "border-emerald-200 bg-emerald-50" : c.status === "nok" ? "border-red-200 bg-red-50" : "border-gray-200 bg-gray-50";
                    const mainCls = c.status === "ok" ? "text-emerald-800" : c.status === "nok" ? "text-red-800" : "text-anthracite";
                    return (
                      <div key={i} className={`border ${cardCls} flex items-start gap-2.5 px-3 py-2.5`}>
                        <span className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold mt-0.5 ${iconCls}`}>
                          {c.status === "ok" ? "✓" : c.status === "nok" ? "!" : "~"}
                        </span>
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold text-anthracite tracking-wide uppercase leading-tight">{c.label}</p>
                          <p className={`text-xs font-medium mt-0.5 leading-tight ${mainCls}`}>{c.main}</p>
                          {c.sub && <p className="text-[10px] text-muted mt-0.5">{c.sub}</p>}
                          {c.ref && <p className="text-[9px] text-muted/70 mt-0.5 italic">{c.ref}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Points d’attention */}
            {(aiAnalysis?.pointsAttention?.length ?? 0) > 0 && (
              <div className="border border-warm-gray bg-warm-gray/10 px-4 py-3 space-y-2">
                <p className="text-[10px] font-semibold tracking-[0.15em] uppercase text-anthracite">Points d&apos;attention</p>
                <ul className="space-y-1.5">
                  {aiAnalysis!.pointsAttention.map((pt, i) => (
                    <li key={i} className="flex items-start gap-2 text-[11px] text-anthracite/80 leading-snug">
                      <span className="shrink-0 text-terracotta mt-0.5">›</span>
                      <span>{pt}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Recommandation */}
            {aiAnalysis?.recommandation && (
              <div className="border-l-2 border-terracotta pl-3">
                <p className="text-[10px] text-muted uppercase tracking-wide mb-0.5">Recommandation</p>
                <p className="text-sm text-anthracite leading-relaxed">{aiAnalysis.recommandation}</p>
              </div>
            )}

            {/* Alerte ZAC */}
            {aiAnalysis?.isZac && (
              <div className="border border-amber-300 bg-amber-50 p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <span className="shrink-0 text-amber-600 text-lg leading-none mt-0.5">⚠</span>
                  <div>
                    <p className="text-sm font-semibold text-amber-900">Zone soumise à une ZAC</p>
                    <p className="text-[11px] text-amber-800 mt-0.5 leading-relaxed">
                      Cette zone fait partie d&apos;une Zone d&apos;Aménagement Concerté. Le règlement PLU seul peut être insuffisant — des règles spécifiques à la ZAC s&apos;appliquent. Importez le règlement de la ZAC pour une analyse complète.
                    </p>
                  </div>
                </div>
                {!zacAnalysis && (
                  <div className="flex flex-col sm:flex-row gap-2 items-start">
                    <label className="flex items-center gap-2 cursor-pointer border border-amber-300 bg-white px-3 py-2 text-xs text-amber-900 hover:border-amber-500 transition-colors">
                      <input type="file" accept=".pdf,image/*" className="hidden"
                        onChange={(e) => { setZacFile(e.target.files?.[0] ?? null); setZacAnalysis(null); setZacAnalysisError(false); }} />
                      {zacFile ? zacFile.name : "Importer le règlement ZAC (PDF)"}
                    </label>
                    {zacFile && (
                      <button type="button" disabled={analyzingZac} onClick={handleZacAnalysis}
                        className="bg-amber-700 text-white text-xs font-semibold tracking-[0.15em] uppercase px-4 py-2 hover:bg-amber-800 transition-colors disabled:opacity-60 flex items-center gap-2">
                        {analyzingZac ? <><span className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />Analyse…</> : "Analyser →"}
                      </button>
                    )}
                  </div>
                )}
                {zacAnalysisError && (
                  <p className="text-xs text-red-700 bg-red-50 border border-red-200 px-3 py-2">
                    Impossible d&apos;analyser le document. Vérifiez le format (PDF ou image) et réessayez.
                  </p>
                )}
                {zacAnalysis && (
                  <div className="border border-amber-200 bg-white divide-y divide-amber-100 mt-2">
                    <div className="p-4">
                      <p className="text-[10px] font-medium tracking-[0.15em] uppercase text-amber-700 mb-1">Règles extraites du règlement ZAC</p>
                      <p className="text-sm text-anthracite leading-relaxed">{zacAnalysis.resume}</p>
                    </div>
                    <div className="p-4 grid grid-cols-3 sm:grid-cols-5 gap-2">
                      {[
                        { label: "Retrait voie", v: zacAnalysis.retraitVoie, unit: "m" },
                        { label: "Retrait latéral", v: zacAnalysis.retraitLateral, unit: "m" },
                        { label: "Retrait fond", v: zacAnalysis.retraitFond, unit: "m" },
                        { label: "Emprise max", v: zacAnalysis.empriseMax, unit: "%" },
                        { label: "Hauteur max", v: zacAnalysis.hauteurMax, unit: "m" },
                      ].map((r) => (
                        <div key={r.label} className="bg-amber-50 border border-amber-200 p-2.5 text-center">
                          <p className="text-sm font-semibold text-anthracite">{r.v === -1 ? "—" : `${r.v} ${r.unit}`}</p>
                          <p className="text-[9px] text-muted mt-0.5 leading-tight">{r.label}</p>
                        </div>
                      ))}
                    </div>
                    {zacAnalysis.reglesArchitecturales.length > 0 && (
                      <div className="p-4">
                        <p className="text-[10px] font-medium tracking-[0.15em] uppercase text-amber-700 mb-2">Règles architecturales ZAC</p>
                        <ul className="space-y-1.5">
                          {zacAnalysis.reglesArchitecturales.map((r, i) => (
                            <li key={i} className="flex items-start gap-2 text-[11px] text-anthracite/80 leading-snug">
                              <span className="shrink-0 text-amber-600 mt-0.5">›</span><span>{r}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="px-4 py-2 flex justify-between items-center">
                      <p className="text-[10px] text-muted italic">{zacAnalysis.avertissement}</p>
                      <button type="button" onClick={() => { setZacAnalysis(null); setZacFile(null); }}
                        className="text-[10px] text-muted hover:text-anthracite underline ml-4 shrink-0">Supprimer</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Récap règles */}
            {aiAnalysis?.recapSections && aiAnalysis.recapSections.length > 0 && (
              <div className="border border-warm-gray">
                <div className="px-4 py-2.5 bg-warm-gray/30 border-b border-warm-gray">
                  <p className="text-[10px] font-semibold tracking-[0.15em] uppercase text-anthracite">Récap des règles PLU</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-warm-gray/60">
                  {aiAnalysis.recapSections.map((sec, i) => (
                    <div key={i} className="px-4 py-3">
                      <p className="text-[10px] font-semibold tracking-wide uppercase text-anthracite mb-1.5">{sec.titre}</p>
                      <ul className="space-y-1">
                        {sec.items.map((item, j) => (
                          <li key={j} className="text-[11px] text-anthracite/70 leading-snug flex items-start gap-1.5">
                            <span className="shrink-0 text-terracotta mt-0.5">›</span><span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Disclaimer */}
            {aiAnalysis?.avertissement && (
              <p className="text-[10px] text-muted italic">{aiAnalysis.avertissement}</p>
            )}

            {/* Nav */}
            <div className="flex gap-3 flex-wrap pt-2">
              <button type="button" onClick={() => setStep(3)}
                className="border border-warm-gray text-anthracite text-xs font-semibold tracking-[0.2em] uppercase px-6 py-3 hover:bg-warm-gray/40 transition-colors">
                ← Retour
              </button>
              <button type="button" onClick={() => {
                setStep(1); setParcel(null); setSelectedFeature(null); setZone(null);
                setMapCenter([46.5, 2.0]); setMapZoom(6);
                setAddress(""); setCommune(""); setSection(""); setRefNumero(""); setSelectedCommune(null);
                setIsLotissement(false); setAddrLon(null); setAddrLat(null); setLotSurface(""); setLotPlanFile(null);
                setLotPolygons([]); setSelectedLotId(null); setCpapFile(null); setLotPlanError(null);
                setProjectType(null); setAiAnalysis(null); setAnalyzeError(false); setAnalyzeOverloaded(false);
                setRules({ retraitVoie: "", retraitLateral: "", retraitFond: "", empriseMax: "", hauteurMax: "" });
                setProjectSurfaceM2(""); setProjectDescriptionLibre("");
                setDrawnShapes([]); setDrawMode(false); setEditMode(null); setShowCotesStep4(false);
                setMeasureMode(false); setManualMeasures([]); setShowZoneConstructible(false);
              }}
                className="border border-warm-gray text-anthracite text-xs font-semibold tracking-[0.2em] uppercase px-6 py-3 hover:bg-warm-gray/40 transition-colors">
                Nouvelle analyse
              </button>
            </div>
          </div>
        );
      })() : null}
    </div>
  );
}
