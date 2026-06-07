"use client";

import { useState, useRef, useEffect } from "react";
import type { PluRules } from "@/lib/geo";
import type { ZoneMode } from "./PlanEditor";

interface PluApiResult {
  resume: string;
  zoneLibelle: string;
  commune: string;
  retraitVoie: number;
  retraitLateral: number;
  retraitFond: number;
  empriseMaxPct: number;
  hauteurMax: number;
  espacesVertsPct: number;
  parkingPlaces: number;
  sourcePlu: boolean;
  pointsAttention: string[];
  resume_cpap: string;
  avertissement: string;
  zone?: { partition: string; zoneLibelle: string; commune: string; description?: string };
  // Règles annexes
  retraitVoirieAnnexe?: number;
  surfaceMaxAnnexe?: number;
  longueurMaxAnnexe?: number;
  hauteurMaxAnnexe?: number;
  // Règles d'aspect
  aspectToiture?: string;
  aspectTuiles?: string;
  aspectMenuiseries?: string;
  aspectClotures?: string;
  aspectVegetaux?: string;
  aspectPiscine?: string;
  aspectTerrasses?: string;
}

interface Props {
  rules: PluRules;
  onChange: (r: PluRules) => void;
  parcel?: { lat: number; lon: number; surface: number } | null;
  pluAnalyzed: boolean;
  onPluAnalyzed: (parkingPlaces: number) => void;
  zoneMode: ZoneMode;
  onZoneModeChange: (mode: ZoneMode) => void;
  accessPoint: { lat: number; lon: number } | null;
  pickingAccess: boolean;
  onPickAccess: () => void;
}

function RuleRow({
  label, value, unit, onChange,
}: {
  label: string;
  value: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[#7a9a7d] text-xs flex-1 leading-tight">{label}</span>
      <div className="flex items-center gap-0.5">
        <input
          type="number"
          min="0"
          step="0.5"
          value={value}
          aria-label={label}
          onChange={e => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v) && v >= 0) onChange(v);
          }}
          className="w-12 bg-transparent text-[#e8f0e9] text-xs font-semibold tabular-nums text-right outline-none border-b border-transparent hover:border-[#2a3d2e] focus:border-[#c4a35a] transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <span className="text-[#5a7a5d] text-xs font-normal">{unit}</span>
      </div>
    </div>
  );
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const TIPS = [
  {
    icon: "🏛️",
    title: "PLU — Plan Local d'Urbanisme",
    text: "Il fixe les règles de construction applicables parcelle par parcelle : emprise, hauteur, retraits, aspect architectural. Chaque commune adopte le sien.",
  },
  {
    icon: "📐",
    title: "Emprise au sol",
    text: "Rapport entre la surface projetée au sol de la construction et la surface totale du terrain. Ex : 40 % d'emprise = 40 m² couverts pour 100 m² de parcelle.",
  },
  {
    icon: "📏",
    title: "Retraits obligatoires",
    text: "Distances minimales entre le bâtiment et les limites de propriété : voirie (rue), latéral (voisins), fond de parcelle. Ils garantissent ensoleillement et intimité.",
  },
  {
    icon: "🟩",
    title: "Zone constructible",
    text: "Le trait vert en pointillés sur le plan représente la zone réellement constructible après application des retraits PLU. Votre bâtiment doit s'y inscrire.",
  },
  {
    icon: "📋",
    title: "CPAP — Cahier des Clauses Architecturales",
    text: "Document propre aux lotissements, il précise les règles d'aspect : toitures, tuiles, menuiseries, clôtures… Il peut être plus restrictif que le PLU.",
  },
  {
    icon: "🌿",
    title: "Espaces verts obligatoires",
    text: "Un pourcentage minimal de la parcelle doit rester en pleine terre ou en espace non imperméabilisé pour favoriser l'infiltration des eaux pluviales.",
  },
  {
    icon: "✏️",
    title: "Après l'analyse",
    text: "Dessinez vos bâtiments sur la carte. La conformité PLU se calcule en temps réel : emprise, retraits, hauteur. Ajustez les valeurs pour explorer les possibilités.",
  },
  {
    icon: "🗺️",
    title: "Zones PLU",
    text: "U (urbaine), AU (à urbaniser), A (agricole), N (naturelle). Les zones U et AU sont constructibles, A et N très réglementées. La zone de votre parcelle détermine les règles applicables.",
  },
  {
    icon: "📦",
    title: "Surface de plancher",
    text: "Différente de l'emprise au sol : elle additionne toutes les surfaces de chaque niveau, déduction faite des combles non aménageables et des garages. Elle peut déclencher le recours à un architecte (>150 m²).",
  },
  {
    icon: "📍",
    title: "Point d'accès voirie",
    text: "Placez le point d'accès côté rue pour que l'outil identifie correctement le retrait voirie vs les retraits latéraux. Un mauvais positionnement peut fausser la zone constructible.",
  },
  {
    icon: "🏠",
    title: "Hauteur des constructions",
    text: "Mesurée soit à l'égout du toit, soit au faîtage (point le plus haut), selon les PLU. Vérifiez le mode de mesure dans les règles affichées — certains PLU combinent les deux.",
  },
  {
    icon: "🏗️",
    title: "Bâtiment principal vs annexe",
    text: "Les annexes (garage, abri de jardin, pool-house) ont souvent des règles allégées : retraits réduits, hauteur inférieure, surface maximale limitée. Sélectionnez le bon type pour chaque volume.",
  },
  {
    icon: "🅿️",
    title: "Stationnement",
    text: "Le PLU impose souvent un nombre de places de parking minimal par logement (ex : 2 places / maison). L'outil calcule automatiquement la surface requise selon l'accès voirie.",
  },
  {
    icon: "🔵",
    title: "Conformité en temps réel",
    text: "Les indicateurs verts/rouges/orange se mettent à jour à chaque modification. Rouge = non conforme, orange = à la limite, vert = conforme. Visez tout vert avant de déposer.",
  },
  {
    icon: "📄",
    title: "Permis de construire",
    text: "Obligatoire pour toute construction neuve >20 m² ou modification de façade. En lotissement, le CPAP s'impose en plus du PLU. Délai d'instruction : 2 à 3 mois en moyenne.",
  },
  {
    icon: "🔲",
    title: "Coefficient de Biotope",
    text: "Certains PLU urbains imposent un COS (coefficient d'occupation des sols) écologique : ratio entre surfaces végétalisées ou perméables et surface totale de la parcelle.",
  },
  {
    icon: "↔️",
    title: "Retrait en limite séparative",
    text: "Certains PLU autorisent de construire directement en limite de propriété (en limite séparative) sous conditions. L'outil propose ce mode via le toggle 'Annexe en limite'.",
  },
  {
    icon: "☀️",
    title: "Règle H/L (ensoleillement)",
    text: "Des PLU imposent que la hauteur d'un bâtiment ne dépasse pas une fraction de la distance à la limite (ex : H ≤ L/2). Cette règle protège l'ensoleillement des voisins.",
  },
  {
    icon: "🌡️",
    title: "RE2020 — Réglementation Environnementale",
    text: "Toute construction neuve depuis 2022 doit respecter la RE2020 : performance thermique, empreinte carbone des matériaux, confort d'été. À prévoir dès la phase de conception.",
  },
  {
    icon: "🧱",
    title: "Aspect architectural",
    text: "Couleurs de façade, pente de toiture, matériaux : le PLU et le CPAP peuvent être très précis. Un refus pour aspect non conforme est aussi fréquent qu'un refus pour non-respect des retraits.",
  },
  {
    icon: "💧",
    title: "Gestion des eaux pluviales",
    text: "Les PLU récents imposent de gérer les eaux pluviales à la parcelle : noues, puits perdu, toiture végétalisée. Intégrez ces ouvrages dans le plan de masse dès le début.",
  },
  {
    icon: "📡",
    title: "Servitudes d'utilité publique",
    text: "Au-delà du PLU, des servitudes (électricité, gaz, voirie, monument historique) peuvent restreindre la constructibilité. L'étude de faisabilité est indicative — vérifiez toujours en mairie.",
  },
] as const;

const ZONE_MODES: { id: ZoneMode; label: string; color: string; active: string }[] = [
  { id: "standard", label: "Reculs PLU",       color: "border-green-600/50 text-green-400",  active: "bg-green-600/20 border-green-500 text-green-300" },
  { id: "annexe",   label: "Annexe en limite",  color: "border-orange-600/50 text-orange-400", active: "bg-orange-600/20 border-orange-500 text-orange-300" },
  { id: "rdc",      label: "RDC en limite",     color: "border-purple-600/50 text-purple-400", active: "bg-purple-600/20 border-purple-500 text-purple-300" },
];

export default function PluPanel({
  rules, onChange, parcel,
  pluAnalyzed, onPluAnalyzed,
  zoneMode, onZoneModeChange,
  accessPoint, pickingAccess, onPickAccess,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PluApiResult | null>(null);
  const [cpapFile, setCpapFile] = useState<File | null>(null);
  const [tipIdx, setTipIdx] = useState(0);
  const [tipVisible, setTipVisible] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loading) return;
    setTipIdx(0);
    setTipVisible(true);
    const interval = setInterval(() => {
      setTipVisible(false);
      setTimeout(() => {
        setTipIdx(i => (i + 1) % TIPS.length);
        setTipVisible(true);
      }, 350);
    }, 4000);
    return () => clearInterval(interval);
  }, [loading]);

  async function analyser() {
    if (!parcel) return;
    setLoading(true);
    setError(null);
    try {
      let cpapBase64: string | undefined;
      let cpapMimeType: string | undefined;
      if (cpapFile) {
        cpapBase64 = await fileToBase64(cpapFile);
        cpapMimeType = cpapFile.type || "application/pdf";
      }
      const res = await fetch("/api/plu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: parcel.lat,
          lon: parcel.lon,
          surface: parcel.surface,
          ...(cpapBase64 ? { cpapBase64, cpapMimeType } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        setError(err.error ?? "Erreur analyse PLU");
        return;
      }
      const data = await res.json() as PluApiResult;
      setResult(data);
      onChange({
        empriseMaxPct:        data.empriseMaxPct        ?? rules.empriseMaxPct,
        retraitVoirie:        data.retraitVoie          ?? rules.retraitVoirie,
        retraitLateral:       data.retraitLateral       ?? rules.retraitLateral,
        retraitFond:          data.retraitFond          ?? rules.retraitFond,
        hauteurMax:           data.hauteurMax           ?? rules.hauteurMax,
        espacesVertsPct:      data.espacesVertsPct      ?? rules.espacesVertsPct,
        retraitVoirieAnnexe:  data.retraitVoirieAnnexe ?? 0,
        surfaceMaxAnnexe:     data.surfaceMaxAnnexe     ?? 0,
        longueurMaxAnnexe:    data.longueurMaxAnnexe    ?? 0,
        hauteurMaxAnnexe:     data.hauteurMaxAnnexe     ?? 0,
        aspectToiture:        data.aspectToiture        ?? "",
        aspectTuiles:         data.aspectTuiles         ?? "",
        aspectMenuiseries:    data.aspectMenuiseries    ?? "",
        aspectClotures:       data.aspectClotures       ?? "",
        aspectVegetaux:       data.aspectVegetaux       ?? "",
        aspectPiscine:        data.aspectPiscine        ?? "",
        aspectTerrasses:      data.aspectTerrasses      ?? "",
      });
      onPluAnalyzed(data.parkingPlaces ?? 0);
    } catch {
      setError("Erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="px-4 py-3 border-b border-[#2a3d2e]/60">
      <p className="text-[#7a9a7d] text-[10px] font-semibold tracking-widest uppercase mb-3">
        Règles PLU / CPAP
      </p>

      {/* CPAP upload */}
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-1">
          <p className="text-[#5a7a5d] text-[10px] flex-1">CPAP / lotissement (optionnel)</p>
          {cpapFile && (
            <button type="button" onClick={() => setCpapFile(null)} className="text-[#4a6a4d] hover:text-red-400 text-[10px]">✕</button>
          )}
        </div>
        {cpapFile ? (
          <p className="text-[#c4a35a] text-[10px] truncate">{cpapFile.name}</p>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full py-1 px-2 rounded border border-dashed border-[#2a3d2e] text-[10px] text-[#5a7a5d] hover:border-[#2d6a4f] hover:text-[#c4a35a] transition-colors"
          >
            + Joindre PDF CPAP
          </button>
        )}
        <input ref={fileRef} type="file" accept=".pdf" className="hidden"
          aria-label="Fichier CPAP"
          onChange={(e) => setCpapFile(e.target.files?.[0] ?? null)} />
      </div>

      {/* Bouton analyser */}
      {parcel ? (
        <div className="space-y-1.5 mb-3">
          <button
            type="button"
            onClick={analyser}
            disabled={loading}
            className="w-full py-1.5 px-3 rounded text-xs font-medium bg-[#2d6a4f] hover:bg-[#246040] text-[#e8f0e9] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Analyse en cours…" : pluAnalyzed ? "Ré-analyser" : "Analyser PLU automatiquement"}
          </button>
          {error && <p className="text-red-400 text-[10px]">{error}</p>}
        </div>
      ) : (
        <p className="text-[#4a6a4d] text-[10px] mb-3">Sélectionnez une parcelle pour analyser le PLU</p>
      )}

      {/* Résultats — visibles uniquement après analyse */}
      {pluAnalyzed && result && (
        <>
          {/* Source */}
          <div className="flex items-center gap-1.5 mb-1">
            {result.sourcePlu ? (
              <span className="text-green-400 text-[10px]">✓ PLU officiel analysé</span>
            ) : (
              <span className="text-yellow-400 text-[10px]">⚠ Estimation IA (PDF non disponible)</span>
            )}
          </div>
          {result.zone?.commune && (
            <p className="text-[#7a9a7d] text-[10px] mb-3">
              {result.zone.commune} · Zone {result.zone.zoneLibelle}
            </p>
          )}

          {/* Côté voirie */}
          <div className="mb-3">
            <button
              type="button"
              onClick={onPickAccess}
              className={`w-full py-1 px-2.5 rounded border text-[10px] font-medium transition-colors ${
                pickingAccess
                  ? "bg-amber-500/20 border-amber-400 text-amber-300 animate-pulse"
                  : accessPoint
                  ? "bg-green-500/10 border-green-600/50 text-green-400"
                  : "border-[#2a3d2e] text-[#7a9a7d] hover:border-[#4a3e32] hover:text-[#a8bfaa]"
              }`}
            >
              {pickingAccess
                ? "Cliquez sur la limite voirie…"
                : accessPoint
                ? "✓ Côté voirie défini"
                : "Définir le côté voirie"}
            </button>
          </div>

          {/* Toggle zone constructible */}
          <div className="mb-3">
            <p className="text-[#5a7a5d] text-[10px] mb-1.5">Zone constructible</p>
            <div className="flex flex-col gap-1">
              {ZONE_MODES.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => onZoneModeChange(m.id)}
                  className={`w-full py-1 px-2.5 rounded border text-[10px] font-medium text-left transition-colors ${
                    zoneMode === m.id ? m.active : `bg-transparent ${m.color} hover:opacity-80`
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {(zoneMode === "annexe" || zoneMode === "rdc") && (
              <div className={`mt-1.5 text-[9px] ${zoneMode === "annexe" ? "text-orange-400/70" : "text-purple-400/70"}`}>
                <p>Valeurs éditables dans le tableau ci-dessous.</p>
              </div>
            )}
          </div>

          {/* Règles numériques — éditables */}
          <div className="flex flex-col gap-1.5 mb-3 p-2.5 rounded bg-[#0a1209]/60 border border-[#2a3d2e]/60">
            {/* Construction principale */}
            <p className="text-[#4a6a4d] text-[9px] font-semibold tracking-widest uppercase mb-0.5">Construction principale</p>
            <RuleRow label="Emprise au sol max"  value={rules.empriseMaxPct}   unit="%" onChange={v => onChange({ ...rules, empriseMaxPct:   v })} />
            <RuleRow label="Recul voirie"         value={rules.retraitVoirie}   unit=" m" onChange={v => onChange({ ...rules, retraitVoirie:   v })} />
            <RuleRow label="Recul limites lat."   value={rules.retraitLateral}  unit=" m" onChange={v => onChange({ ...rules, retraitLateral:  v })} />
            <RuleRow label="Recul fond parcelle"  value={rules.retraitFond}     unit=" m" onChange={v => onChange({ ...rules, retraitFond:     v })} />
            <RuleRow label="Hauteur max"          value={rules.hauteurMax}      unit=" m" onChange={v => onChange({ ...rules, hauteurMax:      v })} />
            <RuleRow label="Espaces verts min"    value={rules.espacesVertsPct} unit="%" onChange={v => onChange({ ...rules, espacesVertsPct: v })} />
            {/* Annexes / dépendances */}
            <div className="border-t border-[#2a3d2e]/60 my-1" />
            <p className="text-[#4a6a4d] text-[9px] font-semibold tracking-widest uppercase mb-0.5">Annexes / dépendances</p>
            <RuleRow label="Hauteur max annexe"   value={rules.hauteurMaxAnnexe}    unit=" m" onChange={v => onChange({ ...rules, hauteurMaxAnnexe:    v })} />
            <RuleRow label="Recul voirie annexe"  value={rules.retraitVoirieAnnexe} unit=" m" onChange={v => onChange({ ...rules, retraitVoirieAnnexe: v })} />
            <RuleRow label="Surface max annexe"   value={rules.surfaceMaxAnnexe}    unit=" m²" onChange={v => onChange({ ...rules, surfaceMaxAnnexe:    v })} />
            <RuleRow label="Longueur max annexe"  value={rules.longueurMaxAnnexe}   unit=" m" onChange={v => onChange({ ...rules, longueurMaxAnnexe:   v })} />
          </div>

          {/* Résumé */}
          {result.resume && (
            <div className="mb-2">
              <p className="text-[#7a9a7d] text-[10px] font-semibold mb-1">Résumé</p>
              <p className="text-[#a8bfaa] text-[10px] leading-relaxed">{result.resume}</p>
            </div>
          )}

          {/* Points d'attention */}
          {result.pointsAttention?.length > 0 && (
            <div className="mb-2">
              <p className="text-[#7a9a7d] text-[10px] font-semibold mb-1">Points d&apos;attention</p>
              <ul className="space-y-0.5">
                {result.pointsAttention.map((pt, i) => (
                  <li key={i} className="text-yellow-400 text-[10px] leading-relaxed flex gap-1">
                    <span>⚠</span><span>{pt}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Résumé CPAP */}
          {result.resume_cpap && (
            <div className="mb-2">
              <p className="text-[#7a9a7d] text-[10px] font-semibold mb-1">Prescriptions CPAP</p>
              <p className="text-[#d4b870] text-[10px] leading-relaxed">{result.resume_cpap}</p>
            </div>
          )}

          {/* Avertissement */}
          {result.avertissement && (
            <div className="p-2 rounded bg-[#0a1209]/60 border border-[#2a3d2e]/60 mb-2">
              <p className="text-[#5a7a5d] text-[10px] leading-relaxed">{result.avertissement}</p>
            </div>
          )}

          {/* Règles d'aspect */}
          {(() => {
            const aspects = [
              { key: "aspectToiture",    label: "Toiture",      icon: "🏠" },
              { key: "aspectTuiles",     label: "Tuiles",       icon: "🧱" },
              { key: "aspectMenuiseries",label: "Menuiseries",  icon: "🪟" },
              { key: "aspectClotures",   label: "Clôtures",     icon: "⛩" },
              { key: "aspectVegetaux",   label: "Végétaux",     icon: "🌿" },
              { key: "aspectPiscine",    label: "Piscine",      icon: "🏊" },
              { key: "aspectTerrasses",  label: "Terrasses",    icon: "🏗" },
            ] as const;
            const filled = aspects.filter(a => result[a.key]);
            if (!filled.length) return null;
            return (
              <div className="mb-2">
                <p className="text-[#7a9a7d] text-[10px] font-semibold mb-1.5">Règles d&apos;aspect</p>
                <div className="flex flex-col gap-1.5">
                  {filled.map(a => (
                    <div key={a.key} className="p-2 rounded bg-[#0a1209]/60 border border-[#2a3d2e]/60">
                      <p className="text-[#5a7a5d] text-[9px] font-semibold uppercase tracking-wider mb-0.5">
                        {a.icon} {a.label}
                      </p>
                      <p className="text-[#a8bfaa] text-[10px] leading-relaxed">{result[a.key]}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </>
      )}

      {/* ── Overlay d'analyse PLU ────────────────────────────────────────── */}
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(7,16,8)]/90 backdrop-blur-md">
          <div className="max-w-sm w-full mx-5 rounded-2xl border border-[#2d6a4f]/60 bg-[#0d1a10] shadow-2xl overflow-hidden">

            {/* En-tête */}
            <div className="flex items-center gap-3 px-6 py-4 border-b border-[#2a3d2e]/60 bg-[#0a1508]">
              <svg className="w-4 h-4 animate-spin text-[#c4a35a] flex-shrink-0" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.25"/>
                <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
              </svg>
              <span className="text-[#c4a35a] text-xs font-semibold tracking-widest uppercase">Analyse PLU en cours…</span>
            </div>

            {/* Illustration — plan schématique */}
            <div className="px-6 pt-5 pb-2">
              <svg viewBox="0 0 260 120" className="w-full h-20" aria-hidden="true">
                {/* Fond parcelle */}
                <rect x="8" y="8" width="244" height="104" rx="2" fill="rgba(45,106,79,0.06)" stroke="#2d6a4f" strokeWidth="1.5" strokeDasharray="8,4"/>
                {/* Zone constructible */}
                <rect x="34" y="28" width="192" height="64" rx="1" fill="rgba(45,106,79,0.10)" stroke="#2d6a4f" strokeWidth="0.8" strokeDasharray="4,3"/>
                {/* Bâtiment principal */}
                <rect x="70" y="40" width="120" height="48" rx="1" fill="rgba(196,163,90,0.14)" stroke="#c4a35a" strokeWidth="1.5"/>
                {/* Flèche retrait voirie */}
                <line x1="8" y1="58" x2="34" y2="58" stroke="#5a9a7a" strokeWidth="0.8"/>
                <polygon points="34,55 34,61 38,58" fill="#5a9a7a"/>
                <text x="10" y="54" fill="#5a9a7a" fontSize="6" fontFamily="monospace">Rv</text>
                {/* Flèche retrait latéral */}
                <line x1="190" y1="20" x2="252" y2="20" stroke="#5a9a7a" strokeWidth="0.8"/>
                <text x="208" y="16" fill="#5a9a7a" fontSize="6" fontFamily="monospace">Rl</text>
                {/* Label bâtiment */}
                <text x="130" y="62" fill="#c4a35a" fontSize="8" textAnchor="middle" fontFamily="monospace" fontWeight="bold">BÂTIMENT</text>
                <text x="130" y="73" fill="#a08050" fontSize="6.5" textAnchor="middle" fontFamily="monospace">emprise · hauteur · retraits</text>
                {/* Accès voirie */}
                <rect x="104" y="108" width="52" height="8" rx="1" fill="#1a2d1e" stroke="#2d6a4f" strokeWidth="0.8"/>
                <text x="130" y="115" fill="#5a7a5d" fontSize="5.5" textAnchor="middle" fontFamily="monospace">VOIRIE</text>
              </svg>
            </div>

            {/* Tip courant */}
            <div className="px-6 pb-5">
              <div className={`rounded-xl bg-[#111f14] border border-[#2d6a4f]/40 p-4 transition-opacity duration-300 ${tipVisible ? "opacity-100" : "opacity-0"}`}>
                <p className="text-[#c4a35a] text-[10px] font-bold uppercase tracking-widest mb-1.5">
                  {TIPS[tipIdx].icon}&nbsp; {TIPS[tipIdx].title}
                </p>
                <p className="text-[#8aaa8d] text-xs leading-relaxed">
                  {TIPS[tipIdx].text}
                </p>
              </div>

              {/* Points de progression */}
              <div className="flex justify-center gap-1.5 mt-3">
                {TIPS.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 rounded-full transition-all duration-500 ${i === tipIdx ? "w-3.5 bg-[#c4a35a]" : "w-1.5 bg-[#1e3a22]"}`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
