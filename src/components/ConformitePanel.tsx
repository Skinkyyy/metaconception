"use client";

import type { ConformiteResult } from "@/lib/geo";

function Row({ label, valeur, reference, unit, conforme, invertLogic = false }: {
  label: string; valeur: number; reference: number; unit: string; conforme: boolean; invertLogic?: boolean;
}) {
  const sign = invertLogic ? (conforme ? "≥" : "<") : (conforme ? "≤" : ">");
  return (
    <div className="flex items-center gap-2">
      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${conforme ? "bg-green-500" : "bg-red-500"}`} />
      <div className="flex-1 min-w-0">
        <p className="text-[#a8bfaa] text-[11px] truncate">{label}</p>
        <p className={`text-xs font-semibold ${conforme ? "text-green-400" : "text-red-400"}`}>
          {valeur.toFixed(1)}{unit}
          <span className="text-[#5a7a5d] font-normal ml-1">
            ({sign} {reference}{unit})
          </span>
        </p>
      </div>
    </div>
  );
}

function InfoRow({ label, valeur, unit }: { label: string; valeur: number; unit: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-1.5 h-1.5 rounded-full shrink-0 bg-[#5a7a5d]" />
      <div className="flex-1 min-w-0">
        <p className="text-[#a8bfaa] text-[11px] truncate">{label}</p>
        <p className="text-xs font-semibold text-[#a8bfaa]">
          {valeur.toFixed(1)}{unit}
        </p>
      </div>
    </div>
  );
}

function GabaritRow({ ratioMin, conforme }: { ratioMin: number; conforme: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${conforme ? "bg-green-500" : "bg-amber-400"}`} />
      <div className="flex-1 min-w-0">
        <p className="text-[#a8bfaa] text-[11px] truncate">Gabarit H ≤ 2L</p>
        <p className={`text-xs font-semibold ${conforme ? "text-green-400" : "text-amber-400"}`}>
          ratio min {ratioMin.toFixed(2)}
          <span className="text-[#5a7a5d] font-normal ml-1">
            ({conforme ? "≥ 0.5 ✓" : "< 0.5 ⚠"})
          </span>
        </p>
      </div>
    </div>
  );
}

export default function ConformitePanel({ conformite }: { conformite: ConformiteResult }) {
  return (
    <div className="px-4 py-3 border-b border-[#2a3d2e]/60">
      <div className="flex items-center gap-2 mb-3">
        <p className="text-[#7a9a7d] text-[10px] font-semibold tracking-widest uppercase">Conformité</p>
        <div className={`ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold ${
          conformite.global
            ? "bg-green-500/20 text-green-400"
            : "bg-red-500/20 text-red-400"
        }`}>
          {conformite.global ? "CONFORME" : "NON CONFORME"}
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        <Row
          label="Emprise au sol"
          valeur={conformite.empriseSol.valeur}
          reference={conformite.empriseSol.max}
          unit="%"
          conforme={conformite.empriseSol.conforme}
        />
        <InfoRow
          label="Surface de plancher"
          valeur={conformite.surfacePlancher.valeur}
          unit=" m²"
        />
        <Row
          label="Hauteur max"
          valeur={conformite.hauteurMax.valeur}
          reference={conformite.hauteurMax.max}
          unit=" m"
          conforme={conformite.hauteurMax.conforme}
        />
        {conformite.gabarit.applique && (
          <GabaritRow
            ratioMin={conformite.gabarit.ratioMin}
            conforme={conformite.gabarit.conforme}
          />
        )}
        {conformite.retraitMin.applique && (
          conformite.retraitMin.enLimite ? (
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full shrink-0 bg-green-500" />
              <div className="flex-1 min-w-0">
                <p className="text-[#a8bfaa] text-[11px] truncate">Retrait min. limites</p>
                <p className="text-xs font-semibold text-green-400">
                  EN LIMITE
                  <span className="text-[#5a7a5d] font-normal ml-1">
                    (0 m ou ≥ {conformite.retraitMin.requis} m)
                  </span>
                </p>
              </div>
            </div>
          ) : (
            <Row
              label="Retrait min. limites"
              valeur={conformite.retraitMin.valeur}
              reference={conformite.retraitMin.requis}
              unit=" m"
              conforme={conformite.retraitMin.conforme}
              invertLogic
            />
          )
        )}
        {conformite.retraitFond.applique && (
          <Row
            label="Retrait fond parcelle"
            valeur={conformite.retraitFond.valeur}
            reference={conformite.retraitFond.requis}
            unit=" m"
            conforme={conformite.retraitFond.conforme}
            invertLogic
          />
        )}
        <Row
          label="Espaces verts"
          valeur={conformite.espacesVerts.valeur}
          reference={conformite.espacesVerts.min}
          unit="%"
          conforme={conformite.espacesVerts.conforme}
          invertLogic
        />
      </div>
    </div>
  );
}
