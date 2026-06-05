"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import type { PluRules } from "@/lib/geo";
import {
  checkConformite, buildCoteLines, minDistToParcel, minDistToFondEdges, minDistToVoirieEdges, buildParkingPolygon,
  measureAccessWidth, areaM2, interiorAreaM2, rotatePoly, pointInRing, DEFAULT_SNAP_CONFIG,
} from "@/lib/geo";
import type { SnapConfig } from "@/lib/geo";
import { SHAPE_TYPE_CONFIG, SHAPE_TYPES_PALETTE } from "./shapeConstants";
import type { ShapeType } from "./shapeConstants";
import PluPanel from "./PluPanel";

const MapOL = dynamic(() => import("./MapOL"), { ssr: false });

export type ZoneMode = "standard" | "annexe" | "rdc";

export interface DrawnShape {
  id: string;
  type: ShapeType;
  polygon: [number, number][];   // [lat, lon][]
  surfaceM2: number;
  label: string;
  hauteurBase: number;           // pied du volume au-dessus du sol naturel (m)
  hauteurFaitage: number;        // sommet du volume — valeur contrôlée PLU (m)
}

export interface ParcelInfo {
  id: string;
  surface: number;
  ring: [number, number][];      // [lon, lat][] GeoJSON
  polygon: [number, number][];   // [lat, lon][] app
}

export interface Building {
  id: string;
  ring: [number, number][];      // [lon, lat][] GeoJSON
  surfaceM2: number;
  hauteur: number | null;
  nbEtages: number | null;
  usage: string;
}

const DEFAULT_PLU: PluRules = {
  empriseMaxPct:        40,
  retraitVoirie:        4,
  retraitLateral:       3,
  retraitFond:          3,
  hauteurMax:           9,
  espacesVertsPct:      20,
  retraitVoirieAnnexe:  0,
  surfaceMaxAnnexe:     0,
  longueurMaxAnnexe:    0,
  hauteurMaxAnnexe:     0,
};

export default function PlanEditor() {
  const params = useSearchParams();
  const lat = parseFloat(params.get("lat") ?? "46.8");
  const lon = parseFloat(params.get("lon") ?? "2.3");
  const address = params.get("address") ?? "";

  const [parcel, setParcel]               = useState<ParcelInfo | null>(null);
  const [shapes, setShapes]               = useState<DrawnShape[]>([]);
  const [tool, setTool]                   = useState<"select" | "draw" | "measure">("select");
  const [drawSubTool, setDrawSubTool]     = useState<"poly" | "rect">("poly");
  const [drawType, setDrawType]           = useState<ShapeType>("rdc");
  const [pluRules, setPluRules]           = useState<PluRules>(DEFAULT_PLU);
  const [pluAnalyzed, setPluAnalyzed]     = useState(false);
  const [parkingPlaces, setParkingPlaces] = useState(0);
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const [editMode, setEditMode]           = useState<"drag" | "rotate" | "vertex" | "dimensions" | null>(null);
  const [zoneMode, setZoneMode]           = useState<ZoneMode>("standard");
  const [accessPoint, setAccessPoint]     = useState<{ lat: number; lon: number } | null>(null);
  const [pickingAccess, setPickingAccess] = useState(false);
  const [existingBuildings, setExistingBuildings] = useState<Building[]>([]);
  const [loadingBuildings, setLoadingBuildings]   = useState(false);
  const [snapConfig, setSnapConfig]       = useState<SnapConfig>(DEFAULT_SNAP_CONFIG);
  const [sidebarWidth, setSidebarWidth]   = useState(288);
  const resizingRef = useRef(false);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = startX - ev.clientX;
      setSidebarWidth(Math.max(220, Math.min(600, startW + delta)));
    };
    const onUp = () => {
      resizingRef.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [sidebarWidth]);

  // ── Calculs dérivés temps réel ────────────────────────────────────────────

  const empriseSol = useMemo(
    () => shapes.filter(s => SHAPE_TYPE_CONFIG[s.type].compteEmpriseSol).reduce((sum, s) => sum + s.surfaceM2, 0),
    [shapes],
  );

  const surfacePlancher = useMemo(
    () => shapes
      .filter(s => SHAPE_TYPE_CONFIG[s.type].compteSurfacePlancher)
      .reduce((sum, s) => {
        const interior = interiorAreaM2(s.polygon); // mesure face intérieure (murs 36 cm)
        // r1 = RDC + 1 étage → 2 niveaux ; r2 = RDC + 2 étages → 3 niveaux
        const floors = s.type === "r2" ? 3 : s.type === "r1" ? 2 : 1;
        const stairs = floors > 1 ? 6 : 0; // 6m² d'escalier pour les bâtiments à étages
        return sum + Math.max(0, interior * floors - stairs);
      }, 0),
    [shapes],
  );

  const hauteurMaxVal = useMemo(
    () => shapes.length > 0 ? Math.max(...shapes.map(s => s.hauteurFaitage)) : 0,
    [shapes],
  );

  const { minSetback, minGabaritRatio, minSetbackFond, minSetbackVoirie } = useMemo(() => {
    if (!parcel || shapes.length === 0) return { minSetback: Infinity, minGabaritRatio: Infinity, minSetbackFond: Infinity, minSetbackVoirie: Infinity };
    let ms = Infinity, mg = Infinity, msf = Infinity, msv = Infinity;
    for (const sh of shapes) {
      const cfg = SHAPE_TYPE_CONFIG[sh.type];
      if (cfg.appliqueRetraitLateral) {
        const d = minDistToParcel(sh.polygon, parcel.ring);
        if (d < ms) ms = d;
        if (accessPoint) {
          const df = minDistToFondEdges(sh.polygon, parcel.ring, accessPoint);
          if (df < msf) msf = df;
        }
      }
      if (cfg.appliqueRetraitVoirie && accessPoint) {
        const dv = minDistToVoirieEdges(sh.polygon, parcel.ring, accessPoint);
        if (dv < msv) msv = dv;
      }
      // Gabarit H ≤ 2L : utilise les cotes visuelles (distance perpendiculaire par face)
      if (cfg.appliqueGabarit && sh.hauteurFaitage > 0) {
        const cotes = buildCoteLines(sh.polygon, parcel.ring);
        for (const c of cotes) {
          const r = c.dist / sh.hauteurFaitage;
          if (r < mg) mg = r;
        }
      }
    }
    return { minSetback: ms, minGabaritRatio: mg, minSetbackFond: msf, minSetbackVoirie: msv };
  }, [shapes, parcel, accessPoint]);

  const conformite = useMemo(() => {
    if (!parcel) return null;
    return checkConformite(
      parcel.surface, empriseSol, surfacePlancher,
      hauteurMaxVal, minSetback, minGabaritRatio, pluRules, minSetbackFond,
    );
  }, [parcel, empriseSol, surfacePlancher, hauteurMaxVal, minSetback, minGabaritRatio, pluRules, minSetbackFond]);

  const parcelCenter = useMemo(() => {
    if (!parcel) return null;
    const lons = parcel.ring.map(p => p[0]);
    const lats = parcel.ring.map(p => p[1]);
    return {
      lat: lats.reduce((a, b) => a + b, 0) / lats.length,
      lon: lons.reduce((a, b) => a + b, 0) / lons.length,
      surface: parcel.surface,
    };
  }, [parcel]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleParcelSelect = useCallback((p: ParcelInfo) => {
    setParcel(p);
    setPluAnalyzed(false);
    setParkingPlaces(0);
    setZoneMode("standard");
    setAccessPoint(null);
    setPickingAccess(false);
    setShapes(prev => prev.filter(s => s.id !== "parking-auto"));
    setSelectedShapeId(null);
    setEditMode(null);
    setExistingBuildings([]);
  }, []);

  const handleAccessSet = useCallback((pt: { lat: number; lon: number }) => {
    setAccessPoint(pt);
    setPickingAccess(false);
  }, []);

  const drawParking = useCallback((places: number, ap: { lat: number; lon: number }, ring: [number, number][]) => {
    if (places <= 0) return;
    const availWidth = measureAccessWidth(ap, ring);
    let w: number, d: number, label: string;
    if (places >= 2 && availWidth >= 5) {
      w = 5;   d = 5;  label = "🅿 2 places côte à côte";
    } else if (places >= 2) {
      w = 3;   d = 10; label = "🅿 2 places en enfilade";
    } else {
      w = 3.5; d = 5;  label = "🅿 1 place";
    }
    const poly = buildParkingPolygon(ap, w, d, ring);
    setShapes(prev => [
      ...prev.filter(s => s.id !== "parking-auto"),
      {
        id: "parking-auto",
        type: "parking",
        polygon: poly,
        surfaceM2: Math.round(areaM2(poly)),
        label,
        hauteurBase: 0,
        hauteurFaitage: 0,
      },
    ]);
  }, []);

  useEffect(() => {
    if (!accessPoint || !parcel || parkingPlaces <= 0) return;
    drawParking(parkingPlaces, accessPoint, parcel.ring);
  }, [accessPoint, parcel, parkingPlaces, drawParking]);

  // Fetch bâtiments BDTOPO V3 quand la parcelle change
  useEffect(() => {
    if (!parcel) return;
    const ring = parcel.ring;
    const lons = ring.map(p => p[0]);
    const lats = ring.map(p => p[1]);
    const west  = Math.min(...lons) - 0.0005;
    const east  = Math.max(...lons) + 0.0005;
    const south = Math.min(...lats) - 0.0005;
    const north = Math.max(...lats) + 0.0005;
    const url =
      `https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature` +
      `&outputFormat=application%2Fjson&typeName=BDTOPO_V3%3Abatiment` +
      `&count=100&SRSNAME=CRS%3A84&BBOX=${west},${south},${east},${north},CRS:84`;

    setLoadingBuildings(true);
    fetch(url)
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (!json?.features) return;
        const buildings: Building[] = [];
        let idx = 0;
        for (const feat of json.features) {
          const geom = feat.geometry;
          if (!geom) continue;
          let coords: [number, number][][] = [];
          if (geom.type === "Polygon") coords = geom.coordinates as [number, number][][];
          else if (geom.type === "MultiPolygon") coords = (geom.coordinates as [number, number][][][]).flat();
          for (const outerRing of coords) {
            if (!outerRing?.length) continue;
            const cLon = outerRing.reduce((s: number, p: [number, number]) => s + p[0], 0) / outerRing.length;
            const cLat = outerRing.reduce((s: number, p: [number, number]) => s + p[1], 0) / outerRing.length;
            if (!pointInRing(cLon, cLat, ring)) continue;
            const props = feat.properties ?? {};
            buildings.push({
              id: `bati-${idx++}`,
              ring: outerRing as [number, number][],
              surfaceM2: Math.round(
                Math.abs(outerRing.reduce((s: number, p: [number, number], i: number) => {
                  const next = outerRing[(i + 1) % outerRing.length];
                  return s + p[0] * next[1] - next[0] * p[1];
                }, 0)) / 2 * 111320 * 111320 * Math.cos((cLat * Math.PI) / 180),
              ),
              hauteur:  typeof props.hauteur === "number" ? props.hauteur : null,
              nbEtages: typeof props.nombre_d_etages === "number" ? props.nombre_d_etages : null,
              usage:    (props.usage_1 as string) ?? "Non renseigné",
            });
            break;
          }
        }
        setExistingBuildings(buildings);
      })
      .catch(() => {})
      .finally(() => setLoadingBuildings(false));
  }, [parcel]);

  const handleShapeDrawn = useCallback((shape: DrawnShape) => {
    setShapes(prev => [...prev, shape]);
  }, []);

  const handleShapeDelete = useCallback((id: string) => {
    setShapes(prev => prev.filter(s => s.id !== id));
    if (selectedShapeId === id) { setSelectedShapeId(null); setEditMode(null); }
  }, [selectedShapeId]);

  const handleShapeSelect = useCallback((id: string | null) => {
    setSelectedShapeId(id);
    if (!id) setEditMode(null);
  }, []);

  const handleShapeUpdate = useCallback((id: string, polygon: [number, number][], surfaceM2: number) => {
    setShapes(prev => prev.map(s => s.id === id ? { ...s, polygon, surfaceM2 } : s));
  }, []);

  // Modification hauteur faîtage en temps réel → recalcul conformité immédiat
  const handleShapeHeightChange = useCallback((id: string, hauteurFaitage: number) => {
    if (isNaN(hauteurFaitage) || hauteurFaitage < 0) return;
    setShapes(prev => prev.map(s => s.id === id ? { ...s, hauteurFaitage } : s));
  }, []);

  // Changement de type → applique les hauteurs par défaut du nouveau type
  const handleShapeTypeChange = useCallback((id: string, type: ShapeType) => {
    const cfg = SHAPE_TYPE_CONFIG[type];
    setShapes(prev => prev.map(s => s.id === id
      ? { ...s, type, label: cfg.label, hauteurBase: cfg.hauteurBaseDefaut, hauteurFaitage: cfg.hauteurFaitageDefaut }
      : s,
    ));
  }, []);

  const handleShapeRotate = useCallback((angleDeg: number) => {
    if (!selectedShapeId) return;
    setShapes(prev => prev.map(s => {
      if (s.id !== selectedShapeId) return s;
      const newPoly = rotatePoly(s.polygon, angleDeg);
      return { ...s, polygon: newPoly, surfaceM2: areaM2(newPoly) };
    }));
  }, [selectedShapeId]);

  return (
    <div className="flex flex-col h-screen bg-[#0d1a10]">

      {/* ── Barre haute ──────────────────────────────────────────────────── */}
      <header className="flex items-center gap-4 px-4 h-12 bg-[#142018] border-b border-[#2a3d2e] shrink-0 z-10">
        <a href="/" className="flex items-center shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-2026.svg" alt="metaconception" className="h-9 w-auto" />
        </a>
        <div className="w-px h-5 bg-[#3c342c]" />
        {address && (
          <p className="text-[#7a9a7d] text-xs truncate max-w-xs hidden md:block">{address}</p>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setTool(tool === "measure" ? "select" : "measure")}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
            tool === "measure"
              ? "bg-[#2d6a4f] text-[#e8f0e9]"
              : "text-[#7a9a7d] hover:text-[#e8f0e9] hover:bg-[#1c2e1f] bg-[#0d1a10]"
          }`}
        >
          📏 Mesure
        </button>
        <div className="w-px h-5 bg-[#3c342c]" />
        {parcel && (
          <span className="text-[#a8bfaa] text-xs hidden lg:block">
            Parcelle {parcel.id} · {Math.round(parcel.surface)} m²
          </span>
        )}
      </header>

      {/* ── Palette dessin : types + outils ─────────────────────────────── */}
      <div className="flex items-center gap-1 px-3 h-8 bg-[#0d1a10] border-b border-[#2a3d2e] shrink-0">
        <span className="text-[#4a6a4d] text-[9px] font-semibold tracking-widest uppercase w-10 shrink-0">Dessin</span>

        {/* Sélecteur de type */}
        {SHAPE_TYPES_PALETTE.map(type => {
          const cfg = SHAPE_TYPE_CONFIG[type];
          const active = drawType === type && tool === "draw";
          return (
            <button
              key={type}
              type="button"
              title={cfg.label}
              onClick={() => { setDrawType(type); setTool("draw"); }}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors border ${
                active
                  ? "text-[#e8f0e9] border-current"
                  : "text-[#5a7a5d] border-transparent hover:text-[#a8bfaa] hover:border-[#2a3d2e]"
              }`}
              style={active ? { color: cfg.color, backgroundColor: cfg.color + "22", borderColor: cfg.color + "88" } : {}}
            >
              <span
                className="w-2 h-2 rounded-sm shrink-0"
                style={{ backgroundColor: active ? cfg.color : "#4a3e32" }}
              />
              {cfg.label}
            </button>
          );
        })}

        <div className="w-px h-4 bg-[#3c342c] mx-0.5" />

        {/* Sous-outil polyligne / rectangle */}
        {([
          { id: "poly", icon: "⬡", label: "Poly" },
          { id: "rect", icon: "▭", label: "Rect" },
        ] as const).map(st => (
          <button
            key={st.id}
            type="button"
            onClick={() => { setTool("draw"); setDrawSubTool(st.id); }}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
              tool === "draw" && drawSubTool === st.id
                ? "bg-[#2d6a4f] text-[#e8f0e9]"
                : "text-[#5a7a5d] hover:text-[#e8f0e9] hover:bg-[#1c2e1f]"
            }`}
          >
            <span>{st.icon}</span>{st.label}
          </button>
        ))}

        {tool === "draw" && (
          <>
            <div className="w-px h-4 bg-[#3c342c] mx-0.5" />
            <div className="flex items-center gap-2.5 text-[#4a6a4d] text-[9px]">
              <span><kbd className="bg-[#142018] text-[#5a7a5d] px-1 rounded text-[9px]">Entrée</kbd> Fermer</span>
              <span><kbd className="bg-[#142018] text-[#5a7a5d] px-1 rounded text-[9px]">⌫</kbd> Annuler</span>
              <span><kbd className="bg-[#142018] text-[#5a7a5d] px-1 rounded text-[9px]">Échap</kbd> Quitter</span>
            </div>
          </>
        )}

        {/* Snap toggles */}
        <div className="ml-auto flex items-center gap-1">
          <span className="text-[#4a6a4d] text-[9px] font-semibold tracking-wider mr-0.5">SNAP</span>
          {([
            { key: "corners"   as keyof SnapConfig, label: "Coins",    dot: "bg-amber-400"   },
            { key: "edges"     as keyof SnapConfig, label: "Arêtes",   dot: "bg-[#8a8070]"   },
            { key: "angles"    as keyof SnapConfig, label: "Ang 5°",   dot: "bg-indigo-400"  },
            { key: "perpLimit" as keyof SnapConfig, label: "⊥ Limite", dot: "bg-[#9db09b]"   },
            { key: "perpSeg"   as keyof SnapConfig, label: "⊥ Seg",    dot: "bg-emerald-400" },
          ]).map(({ key, label, dot }) => (
            <button
              type="button"
              key={key}
              onClick={() => setSnapConfig(c => ({ ...c, [key]: !c[key] }))}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-medium transition-colors ${
                snapConfig[key]
                  ? "border-[#4a3e32] text-[#a8bfaa] bg-[#3c342c]/60"
                  : "border-[#2a3d2e]/50 text-[#4a6a4d] bg-transparent"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${snapConfig[key] ? dot : "bg-[#3c342c]"}`} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Palette édition ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 h-8 bg-[#0d1a10] border-b border-[#2a3d2e] shrink-0">
        <span className="text-[#4a6a4d] text-[9px] font-semibold tracking-widest uppercase w-10 shrink-0">Édition</span>
        <div className="flex items-center gap-1 flex-1">
          <button
            type="button"
            onClick={() => { setTool("select"); setEditMode(null); }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
              tool === "select" && !editMode
                ? "bg-[#2d6a4f] text-[#e8f0e9]"
                : "text-[#7a9a7d] hover:text-[#e8f0e9] hover:bg-[#1c2e1f]"
            }`}
          >
            <svg width="9" height="11" viewBox="0 0 10 13" fill="currentColor" className="shrink-0">
              <path d="M0 0 L0 11 L3.2 7.8 L5.2 12.5 L7 11.8 L5 7.1 L9 7.1 Z" />
            </svg>
            Sélection
          </button>

          {([
            { id: "drag",       label: "Déplacer", icon: "✥" },
            { id: "rotate",     label: "Pivoter",  icon: "↻" },
            { id: "vertex",     label: "Sommets",  icon: "◈" },
            { id: "dimensions", label: "Modifier", icon: "⊢" },
          ] as const).map(m => (
            <button
              type="button"
              key={m.id}
              onClick={() => { setTool("select"); setEditMode(editMode === m.id ? null : m.id); }}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                editMode === m.id ? "bg-[#2d6a4f] text-[#e8f0e9]" : "text-[#7a9a7d] hover:text-[#e8f0e9] hover:bg-[#1c2e1f]"
              }`}
            >
              <span className="text-[12px]">{m.icon}</span>
              {m.label}
            </button>
          ))}

          {editMode === "rotate" && selectedShapeId && (
            <>
              <div className="w-px h-4 bg-[#3c342c] mx-1" />
              {([-90, -45, -15, -5, 5, 15, 45, 90] as const).map(a => (
                <button
                  key={a}
                  type="button"
                  onClick={() => handleShapeRotate(a)}
                  className="px-1.5 py-0.5 rounded text-[10px] font-mono text-[#a8bfaa] hover:text-[#e8f0e9] hover:bg-[#1c2e1f] transition-colors"
                >
                  {a > 0 ? "+" : ""}{a}°
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      {/* ── Corps ────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 relative">
            <MapOL
              center={[lat, lon]}
              zoom={18}
              tool={tool}
              drawSubTool={drawSubTool}
              drawType={drawType}
              onParcelSelect={handleParcelSelect}
              selectedParcel={parcel}
              shapes={shapes}
              onShapeDrawn={handleShapeDrawn}
              onShapeDelete={handleShapeDelete}
              onShapeUpdate={handleShapeUpdate}
              selectedShapeId={selectedShapeId}
              onShapeSelect={handleShapeSelect}
              editMode={editMode}
              pluRules={pluRules}
              pluAnalyzed={pluAnalyzed}
              zoneMode={zoneMode}
              accessPoint={accessPoint}
              pickingAccess={pickingAccess}
              onSetAccess={handleAccessSet}
              existingBuildings={existingBuildings}
              snapConfig={snapConfig}
            />
          </div>

          {/* ── Bandeau conformité ──────────────────────────────────────── */}
          {conformite && parcel && shapes.length > 0 && (
            <div className="h-10 shrink-0 bg-[#0d1a10] border-t border-[#2a3d2e] flex items-center px-3 gap-3 overflow-x-auto">
              {/* Badge global */}
              <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                conformite.global ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
              }`}>
                {conformite.global ? "CONFORME" : "NON CONFORME"}
              </span>
              <span className="w-px h-5 bg-[#2a3d2e] shrink-0" />

              {/* Emprise sol */}
              <span className="flex items-center gap-1 shrink-0">
                <span className={`w-1.5 h-1.5 rounded-full ${conformite.empriseSol.conforme ? "bg-green-500" : "bg-red-500"}`} />
                <span className="text-[#5a7a5d] text-[10px]">Emprise</span>
                <span className={`text-[10px] font-semibold tabular-nums ${conformite.empriseSol.conforme ? "text-green-400" : "text-red-400"}`}>
                  {conformite.empriseSol.valeur.toFixed(0)}% / {conformite.empriseSol.max}%
                </span>
              </span>

              {/* Surface plancher */}
              <span className="flex items-center gap-1 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-[#5a7a5d]" />
                <span className="text-[#5a7a5d] text-[10px]">SP</span>
                <span className="text-[10px] font-semibold tabular-nums text-[#a8bfaa]">
                  {conformite.surfacePlancher.valeur.toFixed(0)} m²
                </span>
              </span>

              {/* Hauteur max */}
              <span className="flex items-center gap-1 shrink-0">
                <span className={`w-1.5 h-1.5 rounded-full ${conformite.hauteurMax.conforme ? "bg-green-500" : "bg-red-500"}`} />
                <span className="text-[#5a7a5d] text-[10px]">Hauteur</span>
                <span className={`text-[10px] font-semibold tabular-nums ${conformite.hauteurMax.conforme ? "text-green-400" : "text-red-400"}`}>
                  {conformite.hauteurMax.valeur.toFixed(1)} m / {conformite.hauteurMax.max} m
                </span>
              </span>

              {/* Gabarit */}
              {conformite.gabarit.applique && (
                <span className="flex items-center gap-1 shrink-0">
                  <span className={`w-1.5 h-1.5 rounded-full ${conformite.gabarit.conforme ? "bg-green-500" : "bg-amber-400"}`} />
                  <span className="text-[#5a7a5d] text-[10px]">Gabarit</span>
                  <span className={`text-[10px] font-semibold tabular-nums ${conformite.gabarit.conforme ? "text-green-400" : "text-amber-400"}`}>
                    {conformite.gabarit.ratioMin.toFixed(2)}
                  </span>
                </span>
              )}

              {/* Retrait latéral */}
              {conformite.retraitMin.applique && (
                <span className="flex items-center gap-1 shrink-0">
                  <span className={`w-1.5 h-1.5 rounded-full ${conformite.retraitMin.enLimite || conformite.retraitMin.conforme ? "bg-green-500" : "bg-red-500"}`} />
                  <span className="text-[#5a7a5d] text-[10px]">Retrait lat.</span>
                  <span className={`text-[10px] font-semibold tabular-nums ${conformite.retraitMin.enLimite || conformite.retraitMin.conforme ? "text-green-400" : "text-red-400"}`}>
                    {conformite.retraitMin.enLimite ? "EN LIMITE" : `${conformite.retraitMin.valeur.toFixed(1)} m`}
                  </span>
                </span>
              )}

              {/* Retrait fond */}
              {conformite.retraitFond.applique && (
                <span className="flex items-center gap-1 shrink-0">
                  <span className={`w-1.5 h-1.5 rounded-full ${conformite.retraitFond.conforme ? "bg-green-500" : "bg-red-500"}`} />
                  <span className="text-[#5a7a5d] text-[10px]">Retrait fond</span>
                  <span className={`text-[10px] font-semibold tabular-nums ${conformite.retraitFond.conforme ? "text-green-400" : "text-red-400"}`}>
                    {conformite.retraitFond.valeur.toFixed(1)} m
                  </span>
                </span>
              )}

              {/* Retrait voirie (annexes et autres formes avec appliqueRetraitVoirie) */}
              {isFinite(minSetbackVoirie) && accessPoint && (
                <span className="flex items-center gap-1 shrink-0">
                  <span className={`w-1.5 h-1.5 rounded-full ${minSetbackVoirie >= pluRules.retraitVoirie ? "bg-green-500" : "bg-red-500"}`} />
                  <span className="text-[#5a7a5d] text-[10px]">Retrait voirie</span>
                  <span className={`text-[10px] font-semibold tabular-nums ${minSetbackVoirie >= pluRules.retraitVoirie ? "text-green-400" : "text-red-400"}`}>
                    {minSetbackVoirie.toFixed(1)} m / {pluRules.retraitVoirie} m
                  </span>
                </span>
              )}

              {/* Espaces verts */}
              <span className="flex items-center gap-1 shrink-0">
                <span className={`w-1.5 h-1.5 rounded-full ${conformite.espacesVerts.conforme ? "bg-green-500" : "bg-red-500"}`} />
                <span className="text-[#5a7a5d] text-[10px]">Esp. verts</span>
                <span className={`text-[10px] font-semibold tabular-nums ${conformite.espacesVerts.conforme ? "text-green-400" : "text-red-400"}`}>
                  {conformite.espacesVerts.valeur.toFixed(0)}% / {conformite.espacesVerts.min}%
                </span>
              </span>
            </div>
          )}
        </div>

        {/* ── Poignée resize sidebar ───────────────────────────────────── */}
        <div
          onMouseDown={handleResizeStart}
          className="w-1 shrink-0 cursor-col-resize bg-[#2a3d2e] hover:bg-[#2d6a4f] transition-colors"
          title="Redimensionner le panneau"
        />

        {/* ── Sidebar ───────────────────────────────────────────────────── */}
        {/* eslint-disable-next-line react/forbid-component-props */}
        <aside
          style={{ width: sidebarWidth }}
          className="bg-[#142018] flex flex-col overflow-y-auto shrink-0"
        >

          {/* Parcelle */}
          {parcel ? (
            <div className="px-4 py-3 border-b border-[#2a3d2e]/60">
              <p className="text-[#7a9a7d] text-[10px] font-semibold tracking-widest uppercase mb-1">Parcelle</p>
              <p className="text-[#e8f0e9] text-sm font-medium">{parcel.id}</p>
              <p className="text-[#7a9a7d] text-xs">{Math.round(parcel.surface)} m²</p>
            </div>
          ) : (
            <div className="px-4 py-4 border-b border-[#2a3d2e]/60">
              <p className="text-[#5a7a5d] text-xs text-center">
                Cliquez sur une parcelle cadastrale pour la sélectionner
              </p>
            </div>
          )}

          {/* Surfaces dessinées */}
          {shapes.length > 0 && (
            <div className="px-4 py-3 border-b border-[#2a3d2e]/60">
              <p className="text-[#7a9a7d] text-[10px] font-semibold tracking-widest uppercase mb-2">
                Surfaces dessinées
              </p>

              <div className="space-y-2">
                {shapes.map(sh => {
                  const cfg = SHAPE_TYPE_CONFIG[sh.type];
                  const isSelected = sh.id === selectedShapeId;
                  return (
                    <div
                      key={sh.id}
                      className={`p-2 rounded border transition-colors ${
                        isSelected
                          ? "border-[#2d6a4f]/50 bg-[#2d6a4f]/10"
                          : "border-[#2a3d2e]/50 bg-[#0d1a10]/40"
                      }`}
                    >
                      {/* Ligne 1 : type + label + supprimer */}
                      <div className="flex items-center gap-1.5 mb-1">
                        <span
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: cfg.color + "33", color: cfg.color }}
                        >
                          {cfg.label}
                        </span>
                        <span className="text-[#a8bfaa] text-[11px] flex-1 truncate">{sh.label}</span>
                        <button
                          type="button"
                          onClick={() => handleShapeDelete(sh.id)}
                          className="text-[#4a6a4d] hover:text-red-400 text-xs transition-colors shrink-0"
                        >
                          ✕
                        </button>
                      </div>

                      {/* Ligne 2 : surface + hauteur + sélecteur de type */}
                      <div className="flex items-center gap-2">
                        <span className="text-[#e8f0e9] text-[11px] font-medium tabular-nums">
                          {Math.round(sh.surfaceM2)} m²
                        </span>
                        {sh.id !== "parking-auto" && (
                          <>
                            <span className="text-[#4a6a4d] text-[10px]">H</span>
                            <input
                              type="number"
                              title="Hauteur faîtage (m)"
                              min="0"
                              max="30"
                              step="0.1"
                              value={sh.hauteurFaitage}
                              onChange={e => handleShapeHeightChange(sh.id, parseFloat(e.target.value))}
                              className="w-14 bg-[#0a1209] text-[#c4a35a] text-[10px] font-mono text-center rounded px-1 py-0.5 border border-[#2a3d2e] focus:border-[#c4a35a] outline-none"
                            />
                            <span className="text-[#4a6a4d] text-[10px]">m</span>
                            {/* Changement de type */}
                            <select
                              title="Type de surface"
                              value={sh.type}
                              onChange={e => handleShapeTypeChange(sh.id, e.target.value as ShapeType)}
                              className="ml-auto bg-[#0a1209] text-[#7a9a7d] text-[9px] rounded px-1 py-0.5 border border-[#2a3d2e] outline-none cursor-pointer"
                            >
                              {SHAPE_TYPES_PALETTE.map(t => (
                                <option key={t} value={t}>{SHAPE_TYPE_CONFIG[t].label}</option>
                              ))}
                            </select>
                          </>
                        )}
                      </div>

                    </div>
                  );
                })}
              </div>

              {/* Totaux */}
              <div className="mt-2 pt-2 border-t border-[#2a3d2e]/60 space-y-0.5">
                <div className="flex justify-between">
                  <span className="text-[#5a7a5d] text-[10px]">Emprise sol</span>
                  <span className="text-[#c4a35a] text-[10px] font-bold tabular-nums">{Math.round(empriseSol)} m²</span>
                </div>
                {surfacePlancher > 0 && (
                  <div className="flex justify-between">
                    <span className="text-[#5a7a5d] text-[10px]">Surface plancher</span>
                    <span className="text-[#d4b870] text-[10px] font-bold tabular-nums">{Math.round(surfacePlancher)} m²</span>
                  </div>
                )}
                {hauteurMaxVal > 0 && (
                  <div className="flex justify-between">
                    <span className="text-[#5a7a5d] text-[10px]">H faîtage max</span>
                    <span className="text-[#a8bfaa] text-[10px] font-bold tabular-nums">{hauteurMaxVal.toFixed(1)} m</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Bâtiments existants BDTOPO */}
          {parcel && (
            <div className="px-4 py-3 border-b border-[#2a3d2e]/60">
              <p className="text-[#7a9a7d] text-[10px] font-semibold tracking-widest uppercase mb-2">
                Bâtiments existants
              </p>
              {loadingBuildings ? (
                <p className="text-[#5a7a5d] text-[10px]">Chargement…</p>
              ) : existingBuildings.length === 0 ? (
                <p className="text-[#4a6a4d] text-[10px]">Aucun bâtiment détecté sur cette parcelle</p>
              ) : (
                <div className="space-y-2">
                  {existingBuildings.map(b => (
                    <div key={b.id} className="p-2 rounded bg-amber-900/20 border border-amber-600/30">
                      <div className="flex justify-between items-start mb-0.5">
                        <span className="text-amber-300 text-[10px] font-medium leading-tight flex-1">{b.usage}</span>
                        <span className="text-amber-400 text-[10px] font-bold tabular-nums ml-2">{b.surfaceM2} m²</span>
                      </div>
                      <div className="flex gap-3">
                        {b.hauteur !== null && <span className="text-[#7a9a7d] text-[10px]">↕ {b.hauteur} m</span>}
                        {b.nbEtages !== null && b.nbEtages > 0 && (
                          <span className="text-[#7a9a7d] text-[10px]">{b.nbEtages} étage{b.nbEtages > 1 ? "s" : ""}</span>
                        )}
                        {b.hauteur === null && b.nbEtages === null && (
                          <span className="text-[#4a6a4d] text-[10px]">Hauteur non renseignée</span>
                        )}
                      </div>
                    </div>
                  ))}
                  <div className="pt-1 border-t border-[#2a3d2e]/60 flex justify-between">
                    <span className="text-[#7a9a7d] text-[10px]">Emprise existante</span>
                    <span className="text-amber-400 text-[10px] font-bold">
                      {existingBuildings.reduce((s, b) => s + b.surfaceM2, 0)} m²
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          <PluPanel
            rules={pluRules}
            onChange={setPluRules}
            parcel={parcelCenter}
            pluAnalyzed={pluAnalyzed}
            onPluAnalyzed={places => { setPluAnalyzed(true); setParkingPlaces(places); }}
            zoneMode={zoneMode}
            onZoneModeChange={setZoneMode}
            accessPoint={accessPoint}
            pickingAccess={pickingAccess}
            onPickAccess={() => setPickingAccess(true)}
          />

          <div className="flex-1" />

          <div className="px-4 py-3 border-t border-[#2a3d2e]/60">
            <p className="text-[#4a6a4d] text-[10px] leading-relaxed">
              Résultats indicatifs. Ne constituent pas un avis juridique ou administratif.
            </p>
          </div>
        </aside>
      </div>

    </div>
  );
}
