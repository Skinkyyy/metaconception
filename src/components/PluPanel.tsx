"use client";

import { useState, useRef } from "react";
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

function RuleRow({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[#7a9a7d] text-xs flex-1 leading-tight">{label}</span>
      <span className="text-[#e8f0e9] text-xs font-semibold tabular-nums">
        {value % 1 === 0 ? value : value.toFixed(1)}
        <span className="text-[#5a7a5d] font-normal ml-0.5">{unit}</span>
      </span>
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
  const fileRef = useRef<HTMLInputElement>(null);

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
              <div className={`mt-1.5 text-[9px] leading-relaxed space-y-0.5 ${zoneMode === "annexe" ? "text-orange-400/80" : "text-purple-400/80"}`}>
                <p>Retrait voirie : <span className="font-semibold">{rules.retraitVoirieAnnexe > 0 ? `${rules.retraitVoirieAnnexe} m` : `${rules.retraitVoirie} m (valeur principale)`}</span></p>
                {rules.surfaceMaxAnnexe > 0 && <p>Surface max : <span className="font-semibold">{rules.surfaceMaxAnnexe} m²</span></p>}
                {rules.longueurMaxAnnexe > 0 && <p>Longueur max : <span className="font-semibold">{rules.longueurMaxAnnexe} m</span></p>}
                {rules.hauteurMaxAnnexe > 0 && <p>Hauteur max : <span className="font-semibold">{rules.hauteurMaxAnnexe} m</span></p>}
                {!rules.surfaceMaxAnnexe && !rules.longueurMaxAnnexe && !rules.hauteurMaxAnnexe && (
                  <p className="opacity-70">Analyser le PLU pour voir les conditions spécifiques.</p>
                )}
              </div>
            )}
          </div>

          {/* Règles numériques — lecture seule */}
          <div className="flex flex-col gap-2 mb-3 p-2.5 rounded bg-[#0a1209]/60 border border-[#2a3d2e]/60">
            <RuleRow label="Emprise au sol max" value={rules.empriseMaxPct}   unit="%" />
            <RuleRow label="Recul voirie"        value={rules.retraitVoirie}   unit=" m" />
            <RuleRow label="Recul limites lat."  value={rules.retraitLateral}  unit=" m" />
            <RuleRow label="Recul fond parcelle" value={rules.retraitFond}     unit=" m" />
            <RuleRow label="Hauteur max"         value={rules.hauteurMax}      unit=" m" />
            <RuleRow label="Espaces verts min"   value={rules.espacesVertsPct} unit="%" />
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
            <div className="p-2 rounded bg-[#0a1209]/60 border border-[#2a3d2e]/60">
              <p className="text-[#5a7a5d] text-[10px] leading-relaxed">{result.avertissement}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
