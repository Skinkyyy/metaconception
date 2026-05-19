"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import L from "leaflet";
import { MapContainer, TileLayer, GeoJSON, Marker, useMapEvents, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
// geoman chargé dynamiquement (accès window interdit au SSR)
/// <reference types="@geoman-io/leaflet-geoman-free" />
import { SHAPE_COLORS, SHAPE_LABELS, SHAPE_DOT_CLS, NIVEAUX_COLORS } from "./shapeConstants";
import { _kLon, seg2dIntersect, removeKnots, computeOffsetPoly, classifyEdgeSetbacks } from "../lib/zoneUtils";

type GeoFeature = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
};

export interface LotPolygon {
  id: string;
  surface: number;
  polygon: [number, number][]; // [lat, lon]
}

export interface Building {
  polygon: [number, number][]; // [lat, lon]
  footprintM2: number;
  hauteur: number;       // mètres
  nbEtages: number;
  usage: string;         // valeur brute BDTOPO
}

export interface AccessPoint {
  lat: number;
  lon: number;
  angleDeg: number; // rotation CSS horaire depuis le nord (0° = flèche vers le nord)
}

export interface DrawnShape {
  id: string;
  type: string;   // "batiment" | "extension" | "garage" | "piscine" | "autre"
  label: string;
  polygon: [number, number][]; // [lat, lon][] — 4 coins du rectangle
  surfaceM2: number;
  niveaux?: "rdc" | "r1" | "r2" | "annexe";
  nonEmprise?: boolean; // ne compte pas dans l'emprise au sol (ex: parking non clos)
}

interface Props {
  center: [number, number];
  zoom: number;
  selectedFeature?: GeoFeature | null;
  onParcelSelect: (feature: GeoFeature) => void;
  lotPolygons?: LotPolygon[];
  selectedLotId?: string | null;
  onLotSelect?: (lot: LotPolygon) => void;
  // Flèche d'accès
  accessMode?: boolean;
  accessPoint?: AccessPoint | null;
  onAccessPointSet?: (point: AccessPoint) => void;
  // Constructions existantes BDTOPO
  existingBuildings?: Building[];
  // Dessin de projet
  drawMode?: boolean;
  drawShapeType?: string;
  drawnShapes?: DrawnShape[];
  onShapeDrawn?: (shape: DrawnShape) => void;
  onShapeDelete?: (id: string) => void;
  onShapeUpdated?: (id: string, polygon: [number, number][], surfaceM2: number) => void;
  // "drag" | "rotate" | "vertex" | null — mode d'édition
  editMode?: "drag" | "rotate" | "vertex" | null;
  // Formes affichées en lecture seule (step 4 — pas d'interaction, rendu déclaratif)
  readOnlyShapes?: DrawnShape[];
  showReadOnlyCotes?: boolean;
  // Mesure manuelle (step 4)
  measureMode?: boolean;
  manualMeasures?: ManualMeasure[];
  onAddManualMeasure?: (m: ManualMeasure) => void;
  // Sélection forcée d'une forme (bouton Modifier dans la liste)
  editSelectKey?: { id: string; token: number } | null;
  // Zone constructible (step 4)
  zoneConstructible?: {
    rv: number; rl: number; rf: number;
    hasAnnexes: boolean;
    annexeRetraits?: { type: string; surfaceMaxM2?: number; hauteurMaxM?: number; enLimite: boolean }[];
  } | null;
  // Plein écran
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  // Panneau latéral (rendu à l'intérieur du conteneur plein écran)
  overlayPanel?: React.ReactNode;
}

export type ManualMeasure = {
  id: string;
  from: [number, number]; // [lat, lon]
  to: [number, number];   // [lat, lon]
  dist: number;           // mètres
};

// ── Calcul de l'angle de la normale entrante la plus proche du clic ──────────
// ring : anneau GeoJSON [lon, lat][]
function computeInwardAngle(clickLat: number, clickLon: number, ring: [number, number][]): number {
  // Centroïde de la parcelle pour déterminer le sens « intérieur »
  const cLon = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cLat = ring.reduce((s, p) => s + p[1], 0) / ring.length;

  let minDist = Infinity;
  let bestNLon = 0, bestNLat = 1;

  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];   // [lon, lat]
    const [x2, y2] = ring[i + 1];
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-18) continue;

    const t = Math.max(0, Math.min(1, ((clickLon - x1) * dx + (clickLat - y1) * dy) / len2));
    const projLon = x1 + t * dx;
    const projLat = y1 + t * dy;
    const dist = Math.hypot(clickLon - projLon, clickLat - projLat);

    if (dist < minDist) {
      minDist = dist;
      // Deux normales perpendiculaires à l'arête
      const n1Lon = -dy, n1Lat = dx;
      const n2Lon = dy, n2Lat = -dx;
      // On garde celle qui pointe vers le centroïde (= vers l'intérieur)
      const dot1 = n1Lon * (cLon - projLon) + n1Lat * (cLat - projLat);
      if (dot1 > 0) { bestNLon = n1Lon; bestNLat = n1Lat; }
      else           { bestNLon = n2Lon; bestNLat = n2Lat; }
    }
  }

  // Angle CSS horaire depuis le nord : atan2(Δlon, Δlat)
  return Math.atan2(bestNLon, bestNLat) * (180 / Math.PI);
}

// ── Icône SVG de la flèche d'accès ───────────────────────────────────────────
function makeArrowIcon(angleDeg: number): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    html: `
      <div style="width:44px;height:44px;transform:rotate(${angleDeg}deg);transform-origin:center;">
        <svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="22" cy="22" r="20" fill="white" stroke="#1d4ed8" stroke-width="2.5" opacity="0.95"/>
          <!-- Flèche pointant vers le haut (nord = intérieur de la parcelle) -->
          <path d="M22 7 L31 23 L25 23 L25 37 L19 37 L19 23 L13 23 Z" fill="#1d4ed8"/>
        </svg>
      </div>`,
  });
}

// ── Couche flèche d'accès ────────────────────────────────────────────────────

function AccessLayer({
  parcelGeometry,
  accessMode,
  accessPoint,
  onAccessPointSet,
}: {
  parcelGeometry: GeoFeature["geometry"] | null;
  accessMode: boolean;
  accessPoint: AccessPoint | null;
  onAccessPointSet: (p: AccessPoint) => void;
}) {
  const map = useMap();

  // Extraire l'anneau extérieur de la parcelle sélectionnée
  const ring = useMemo<[number, number][] | null>(() => {
    if (!parcelGeometry) return null;
    if (parcelGeometry.type === "Polygon")
      return (parcelGeometry.coordinates as [number, number][][])[0];
    if (parcelGeometry.type === "MultiPolygon")
      return (parcelGeometry.coordinates as [number, number][][][])[0][0];
    return null;
  }, [parcelGeometry]);

  // Curseur
  useEffect(() => {
    map.getContainer().style.cursor = accessMode ? "crosshair" : "";
    return () => { map.getContainer().style.cursor = ""; };
  }, [accessMode, map]);

  useMapEvents({
    click(e) {
      if (!accessMode) return;
      const { lat, lng: lon } = e.latlng;
      const angleDeg = ring ? computeInwardAngle(lat, lon, ring) : 0;
      onAccessPointSet({ lat, lon, angleDeg });
    },
  });

  if (!accessPoint) return null;

  return (
    <Marker
      position={[accessPoint.lat, accessPoint.lon]}
      icon={makeArrowIcon(accessPoint.angleDeg)}
    />
  );
}

// ── Dessin de projet ─────────────────────────────────────────────────────────

// Direction (vecteur unitaire) de l'arête la plus proche en [lon, lat] space
function nearestEdgeDir(lon: number, lat: number, ring: [number, number][]): [number, number] {
  let minD = Infinity, bux = 1, buy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-20) continue;
    const t = Math.max(0, Math.min(1, ((lon - x1) * dx + (lat - y1) * dy) / len2));
    const d = Math.hypot(lon - x1 - t * dx, lat - y1 - t * dy);
    if (d < minD) { minD = d; const l = Math.sqrt(len2); bux = dx / l; buy = dy / l; }
  }
  return [bux, buy];
}

// Rectangle avec angles réellement droits (projection en espace métrique)
// ux, uy : direction de l'arête en espace lon/lat
// → retourne [lat, lon][] (convention app)
function buildRotatedRect(
  aLon: number, aLat: number, bLon: number, bLat: number,
  ux: number, uy: number,
): [number, number][] {
  const avgLat = (aLat + bLat) / 2;
  const kLat = 111320;
  const kLon = kLat * Math.cos((avgLat * Math.PI) / 180);

  // Vecteur de l'arête en mètres puis normalisation
  const ex = ux * kLon, ey = uy * kLat;
  const eLen = Math.sqrt(ex * ex + ey * ey);
  if (eLen < 1e-10) return [];
  const enx = ex / eLen, eny = ey / eLen;   // dir unitaire en mètres
  const pnx = -eny, pny = enx;               // perp. à 90° en mètres

  // Projection de AB en mètres
  const abx = (bLon - aLon) * kLon;
  const aby = (bLat - aLat) * kLat;
  const t = abx * enx + aby * eny;   // longueur le long de l'arête (m)
  const s = abx * pnx + aby * pny;   // largeur perpendiculaire (m)

  // Reconversion en lon/lat → [lat, lon][]
  return [
    [aLat,                                        aLon                                       ],
    [aLat + (t * eny) / kLat,                     aLon + (t * enx) / kLon                    ],
    [aLat + (t * eny + s * pny) / kLat,           aLon + (t * enx + s * pnx) / kLon          ],
    [aLat            + (s * pny) / kLat,           aLon            + (s * pnx) / kLon          ],
  ];
}

// Aire d'un polygone quelconque [lat, lon][] en m² (formule du lacet)
function geoAreaM2(poly: [number, number][]): number {
  const n = poly.length;
  if (n < 3) return 0;
  const avgLat = poly.reduce((s, [lat]) => s + lat, 0) / n;
  const kLat = 111320, kLon = kLat * Math.cos((avgLat * Math.PI) / 180);
  let a = 0;
  for (let i = 0; i < n; i++) {
    const [lat1, lon1] = poly[i], [lat2, lon2] = poly[(i + 1) % n];
    a += lon1 * kLon * (lat2 * kLat) - lon2 * kLon * (lat1 * kLat);
  }
  return Math.round(Math.abs(a) / 2);
}

// Point le plus proche sur un anneau (coordonnées homogènes)
function nearestOnRing(px: number, py: number, ring: [number, number][]): [number, number] {
  let minD = Infinity, bx = ring[0][0], by = ring[0][1];
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    const t = len2 < 1e-20 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
    const nx = x1 + t * dx, ny = y1 + t * dy;
    const d = Math.hypot(px - nx, py - ny);
    if (d < minD) { minD = d; bx = nx; by = ny; }
  }
  return [bx, by];
}

// Distance approx en mètres entre deux points [lat, lon]
function distMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const kLat = 111320, kLon = kLat * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  return Math.sqrt(((lat2 - lat1) * kLat) ** 2 + ((lon2 - lon1) * kLon) ** 2);
}

// Rectangle à partir d'une ancre, d'une direction (snap) et de dimensions en mètres
function buildRectFromDims(
  aLon: number, aLat: number,
  ux: number, uy: number,
  lengthM: number, widthM: number,
): [number, number][] {
  const kLat = 111320;
  const kLon = kLat * Math.cos((aLat * Math.PI) / 180);
  const ex = ux * kLon, ey = uy * kLat;
  const eLen = Math.sqrt(ex * ex + ey * ey);
  if (eLen < 1e-10) return [];
  const enx = ex / eLen, eny = ey / eLen;
  const pnx = -eny, pny = enx;
  return [
    [aLat,                                                    aLon                                                   ],
    [aLat + (lengthM * eny) / kLat,                           aLon + (lengthM * enx) / kLon                          ],
    [aLat + (lengthM * eny + widthM * pny) / kLat,            aLon + (lengthM * enx + widthM * pnx) / kLon           ],
    [aLat +                  (widthM * pny) / kLat,            aLon +                  (widthM * pnx) / kLon           ],
  ];
}

// Côtes par lancer de rayon perpendiculaire à chaque face
// poly: [lat,lon][]  parcelRing: [lon,lat][]  buildingRings: [lat,lon][][]
type CoteClickInfo = { nx: number; ny: number; dist: number; latlng: L.LatLng };

function buildCoteLines(
  poly: [number, number][],
  parcelRing: [number, number][],
  buildingRings?: [number, number][][],
  onCoteClick?: (info: CoteClickInfo) => void,
): L.Layer[] {
  const n = poly.length;
  const kLat = 111320;
  const avgLat = poly.reduce((s, [lat]) => s + lat, 0) / n;
  const kLon = kLat * Math.cos((avgLat * Math.PI) / 180);

  // Tous les obstacles en mètres : parcelle [lon,lat] → [x,y] ; bâtiments [lat,lon] → [x,y]
  const allRingsM: [number, number][][] = [
    parcelRing.map(([lon, lat]) => [lon * kLon, lat * kLat] as [number, number]),
    ...(buildingRings ?? []).map((ring) =>
      ring.map(([lat, lon]) => [lon * kLon, lat * kLat] as [number, number])
    ),
  ];

  // Poly en mètres pour calculer les normales de faces
  const polyM = poly.map(([lat, lon]) => [lon * kLon, lat * kLat] as [number, number]);
  const ctrx = polyM.reduce((s, [x]) => s + x, 0) / n;
  const ctry = polyM.reduce((s, [, y]) => s + y, 0) / n;

  const layers: L.Layer[] = [];

  for (let i = 0; i < n; i++) {
    const [mx1, my1] = polyM[i], [mx2, my2] = polyM[(i + 1) % n];
    const midx = (mx1 + mx2) / 2, midy = (my1 + my2) / 2;
    const mLat = midy / kLat, mLon = midx / kLon;

    // Normale sortante (perpendiculaire à la face, dirigée vers l'extérieur)
    const fdx = mx2 - mx1, fdy = my2 - my1;
    const flen = Math.sqrt(fdx * fdx + fdy * fdy);
    if (flen < 0.01) continue;
    let nx = -fdy / flen, ny = fdx / flen;
    if (nx * (ctrx - midx) + ny * (ctry - midy) > 0) { nx = -nx; ny = -ny; }

    // Lancer de rayon : première intersection sur [0.05 m, 150 m]
    let bestT = Infinity, bestFx = 0, bestFy = 0;
    for (const ringM of allRingsM) {
      for (let j = 0; j < ringM.length - 1; j++) {
        const [x1, y1] = ringM[j], [x2, y2] = ringM[j + 1];
        const sdx = x2 - x1, sdy = y2 - y1;
        const denom = nx * sdy - ny * sdx;
        if (Math.abs(denom) < 1e-10) continue;
        const tx = x1 - midx, ty = y1 - midy;
        const t = (tx * sdy - ty * sdx) / denom;
        const s = (tx * ny - ty * nx) / denom;
        if (t < 0.05 || t > 150 || s < 0 || s > 1) continue;
        if (t < bestT) { bestT = t; bestFx = x1 + s * sdx; bestFy = y1 + s * sdy; }
      }
    }

    if (!isFinite(bestT)) continue;
    const fLat = bestFy / kLat, fLon = bestFx / kLon;
    const txt = bestT < 10 ? bestT.toFixed(2) : bestT.toFixed(1);
    const midLatlng = L.latLng((mLat + fLat) / 2, (mLon + fLon) / 2);
    const coteMarker = L.marker(midLatlng, {
      icon: L.divIcon({
        className: "",
        iconSize: [52, 18],
        iconAnchor: [26, 9],
        html: `<div style="background:#fff;border:1.5px solid #1d4ed8;border-radius:3px;padding:1px 5px;font-size:10px;font-weight:700;color:#1d4ed8;text-align:center;white-space:nowrap${onCoteClick ? ";cursor:pointer;box-shadow:0 0 0 2px #c7d2fe" : ""}">${txt} m</div>`,
      }),
      interactive: !!onCoteClick,
      zIndexOffset: 700,
    });
    if (onCoteClick) {
      const _nx = nx, _ny = ny, _dist = bestT;
      coteMarker.on("click", (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        onCoteClick({ nx: _nx, ny: _ny, dist: _dist, latlng: midLatlng });
      });
    }
    layers.push(
      L.polyline([[mLat, mLon], [fLat, fLon]], {
        color: "#1d4ed8", weight: 1.5, dashArray: "5 4", opacity: 0.8, interactive: false,
      }),
      coteMarker,
    );
  }
  return layers;
}

function buildMinDistIndicators(
  poly: [number, number][],
  parcelRing: [number, number][],
): L.Layer[] {
  const n = poly.length;
  if (n < 2) return [];
  const kLat = 111320;
  const avgLat = poly.reduce((s, [lat]) => s + lat, 0) / n;
  const kLon = kLat * Math.cos((avgLat * Math.PI) / 180);
  const polyM   = poly.map(([lat, lon]) => [lon * kLon, lat * kLat] as [number, number]);
  const parcelM = parcelRing.map(([lon, lat]) => [lon * kLon, lat * kLat] as [number, number]);

  type VInfo = { vx: number; vy: number; fx: number; fy: number; dist: number };
  const infos: VInfo[] = [];
  let minDist = Infinity;
  const seenV = new Set<string>();

  for (const [vx, vy] of polyM) {
    const vKey = `${vx.toFixed(3)},${vy.toFixed(3)}`;
    if (seenV.has(vKey)) continue;
    seenV.add(vKey);
    let bestDist = Infinity, bestFx = vx, bestFy = vy;
    for (let j = 0; j < parcelM.length - 1; j++) {
      const [ax, ay] = parcelM[j], [bx, by] = parcelM[j + 1];
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-10) continue;
      const t = Math.max(0, Math.min(1, ((vx - ax) * dx + (vy - ay) * dy) / len2));
      const fx = ax + t * dx, fy = ay + t * dy;
      const d = Math.sqrt((vx - fx) ** 2 + (vy - fy) ** 2);
      if (d < bestDist) { bestDist = d; bestFx = fx; bestFy = fy; }
    }
    infos.push({ vx, vy, fx: bestFx, fy: bestFy, dist: bestDist });
    if (bestDist < minDist) minDist = bestDist;
  }
  if (!isFinite(minDist)) return [];

  const layers: L.Layer[] = [];
  for (const { vx, vy, fx, fy, dist } of infos) {
    if (dist > minDist + 0.5) continue;
    const vLat = vy / kLat, vLon = vx / kLon;
    const fLat = fy / kLat, fLon = fx / kLon;
    const mLat = (vLat + fLat) / 2, mLon = (vLon + fLon) / 2;
    const txt = dist < 10 ? dist.toFixed(2) : dist.toFixed(1);
    layers.push(
      L.polyline([[vLat, vLon], [fLat, fLon]], {
        color: "#94a3b8", weight: 1, dashArray: "3 4", opacity: 0.65, interactive: false,
      }),
      L.marker([mLat, mLon], {
        icon: L.divIcon({
          className: "",
          iconSize: [36, 15],
          iconAnchor: [18, 7],
          html: `<div style="background:rgba(255,255,255,0.85);border:1px solid #94a3b8;border-radius:2px;padding:0 3px;font-size:8px;color:#64748b;text-align:center;white-space:nowrap">${txt} m</div>`,
        }),
        interactive: false,
        zIndexOffset: 650,
      }),
    );
  }
  return layers;
}

function ReadOnlyCotesLayer({
  shapes,
  parcelRing,
  existingBuildings = [],
}: {
  shapes: DrawnShape[];
  parcelRing: [number, number][] | null;
  existingBuildings?: Building[];
}) {
  const map = useMap();
  const layersRef = useRef<L.Layer[]>([]);

  useEffect(() => {
    layersRef.current.forEach((l) => { try { map.removeLayer(l); } catch { /* */ } });
    layersRef.current = [];
    if (!parcelRing || shapes.length === 0) return;
    const bRings = existingBuildings.map((b) => b.polygon);
    const newLayers: L.Layer[] = [];
    for (const shape of shapes) {
      if (shape.nonEmprise) continue;
      const cotes = buildCoteLines(shape.polygon, parcelRing, bRings);
      cotes.forEach((l) => { l.addTo(map); newLayers.push(l); });
    }
    layersRef.current = newLayers;
    return () => {
      layersRef.current.forEach((l) => { try { map.removeLayer(l); } catch { /* */ } });
      layersRef.current = [];
    };
  }, [shapes, parcelRing, existingBuildings, map]);

  return null;
}

// ── Snap pour la mesure manuelle ─────────────────────────────────────────────
// Priorités : 1) coin de bâtiment/parcelle  2) arête bâtiment  3) perp. limite parcelle

/** Snap P1 : coins de bâtiments/forme, puis arêtes, puis brut */
function snapFirstPoint(
  click: L.LatLng,
  ring: [number, number][] | null,   // [lon, lat][]
  obstRings: [number, number][][],   // [lat, lon][][]
  cornerT = 0.5, edgeT = 0.5,
): [number, number] {
  const kLat = 111320, kLon = _kLon(click.lat);
  const cx = click.lng * kLon, cy = click.lat * kLat;

  // 1. Corners — parcel vertices
  let best = cornerT, bLat = click.lat, bLon = click.lng;
  if (ring) {
    for (const [lon, lat] of ring) {
      const d = Math.sqrt((lon * kLon - cx) ** 2 + (lat * kLat - cy) ** 2);
      if (d < best) { best = d; bLat = lat; bLon = lon; }
    }
  }
  if (best < cornerT) return [bLat, bLon];

  // 2. Corners — obstacles
  for (const r of obstRings) {
    for (const [lat, lon] of r) {
      const d = Math.sqrt((lon * kLon - cx) ** 2 + (lat * kLat - cy) ** 2);
      if (d < best) { best = d; bLat = lat; bLon = lon; }
    }
  }
  if (best < cornerT) return [bLat, bLon];

  // 3. Edges — obstacles
  let eBest = edgeT;
  for (const r of obstRings) {
    for (let i = 0; i < r.length - 1; i++) {
      const [lat1, lon1] = r[i], [lat2, lon2] = r[(i + 1) % r.length];
      const x1 = lon1 * kLon, y1 = lat1 * kLat, x2 = lon2 * kLon, y2 = lat2 * kLat;
      const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
      if (len2 < 1e-10) continue;
      const t = Math.max(0, Math.min(1, ((cx - x1) * dx + (cy - y1) * dy) / len2));
      const fx = x1 + t * dx, fy = y1 + t * dy;
      const d = Math.sqrt((cx - fx) ** 2 + (cy - fy) ** 2);
      if (d < eBest) { eBest = d; bLat = fy / kLat; bLon = fx / kLon; }
    }
  }
  if (eBest < edgeT) return [bLat, bLon];

  return [click.lat, click.lng];
}

/** Snap P2 : coins > perp. limite > arêtes obstacles > brut */
function snapSecondPoint(
  from: [number, number],            // [lat, lon] P1
  click: L.LatLng,
  ring: [number, number][] | null,   // [lon, lat][]
  obstRings: [number, number][][],   // [lat, lon][][]
  cornerT = 0.5, parcelT = 1, edgeT = 0.5,
): [number, number] {
  const kLat = 111320, kLon = _kLon((from[0] + click.lat) / 2);
  const cx = click.lng * kLon, cy = click.lat * kLat;

  // 1. Corners — parcel
  let best = cornerT, bLat = click.lat, bLon = click.lng;
  if (ring) {
    for (const [lon, lat] of ring) {
      const d = Math.sqrt((lon * kLon - cx) ** 2 + (lat * kLat - cy) ** 2);
      if (d < best) { best = d; bLat = lat; bLon = lon; }
    }
  }
  if (best < cornerT) return [bLat, bLon];

  // 2. Corners — obstacles
  for (const r of obstRings) {
    for (const [lat, lon] of r) {
      const d = Math.sqrt((lon * kLon - cx) ** 2 + (lat * kLat - cy) ** 2);
      if (d < best) { best = d; bLat = lat; bLon = lon; }
    }
  }
  if (best < cornerT) return [bLat, bLon];

  // 3. Perpendiculaire depuis P1 vers arête parcelle
  if (ring) {
    const px = from[1] * kLon, py = from[0] * kLat;
    let pBest = parcelT;
    for (let i = 0; i < ring.length - 1; i++) {
      const [lon1, lat1] = ring[i], [lon2, lat2] = ring[i + 1];
      const x1 = lon1 * kLon, y1 = lat1 * kLat, x2 = lon2 * kLon, y2 = lat2 * kLat;
      const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
      if (len2 < 1e-10) continue;
      const tc = Math.max(0, Math.min(1, ((cx - x1) * dx + (cy - y1) * dy) / len2));
      const d = Math.sqrt((cx - (x1 + tc * dx)) ** 2 + (cy - (y1 + tc * dy)) ** 2);
      if (d < pBest) {
        pBest = d;
        const tp = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
        bLat = (y1 + tp * dy) / kLat;
        bLon = (x1 + tp * dx) / kLon;
      }
    }
    if (pBest < parcelT) return [bLat, bLon];
  }

  // 4. Arêtes — obstacles
  let eBest = edgeT;
  for (const r of obstRings) {
    for (let i = 0; i < r.length - 1; i++) {
      const [lat1, lon1] = r[i], [lat2, lon2] = r[(i + 1) % r.length];
      const x1 = lon1 * kLon, y1 = lat1 * kLat, x2 = lon2 * kLon, y2 = lat2 * kLat;
      const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
      if (len2 < 1e-10) continue;
      const t = Math.max(0, Math.min(1, ((cx - x1) * dx + (cy - y1) * dy) / len2));
      const fx = x1 + t * dx, fy = y1 + t * dy;
      const d = Math.sqrt((cx - fx) ** 2 + (cy - fy) ** 2);
      if (d < eBest) { eBest = d; bLat = fy / kLat; bLon = fx / kLon; }
    }
  }
  if (eBest < edgeT) return [bLat, bLon];

  return [click.lat, click.lng];
}

// ── Snap pour les sommets en mode édition vertex ─────────────────────────────
// Accroche sur les arêtes de la parcelle et les coins/arêtes des bâtiments existants.
function snapVertexPoint(
  latlng: L.LatLng,
  ring: [number, number][] | null,   // [lon, lat][] parcelle
  obstRings: [number, number][][],   // [lat, lon][][] bâtiments
  threshold = 0.25,
): L.LatLng {
  const kLat = 111320, kLon = _kLon(latlng.lat);
  const cx = latlng.lng * kLon, cy = latlng.lat * kLat;
  let bestDist = threshold, bLat = latlng.lat, bLon = latlng.lng;

  // 1. Arêtes + coins de la parcelle
  if (ring) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [lon1, lat1] = ring[i], [lon2, lat2] = ring[i + 1];
      const x1 = lon1 * kLon, y1 = lat1 * kLat, x2 = lon2 * kLon, y2 = lat2 * kLat;
      const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
      if (len2 < 1e-10) continue;
      const t = Math.max(0, Math.min(1, ((cx - x1) * dx + (cy - y1) * dy) / len2));
      const fx = x1 + t * dx, fy = y1 + t * dy;
      const d = Math.sqrt((cx - fx) ** 2 + (cy - fy) ** 2);
      if (d < bestDist) { bestDist = d; bLat = fy / kLat; bLon = fx / kLon; }
    }
  }

  // 2. Coins de bâtiments existants
  for (const r of obstRings) {
    for (const [lat, lon] of r) {
      const d = Math.sqrt((lon * kLon - cx) ** 2 + (lat * kLat - cy) ** 2);
      if (d < bestDist) { bestDist = d; bLat = lat; bLon = lon; }
    }
  }

  // 3. Arêtes de bâtiments existants
  for (const r of obstRings) {
    for (let i = 0; i < r.length - 1; i++) {
      const [lat1, lon1] = r[i], [lat2, lon2] = r[(i + 1) % r.length];
      const x1 = lon1 * kLon, y1 = lat1 * kLat, x2 = lon2 * kLon, y2 = lat2 * kLat;
      const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
      if (len2 < 1e-10) continue;
      const t = Math.max(0, Math.min(1, ((cx - x1) * dx + (cy - y1) * dy) / len2));
      const fx = x1 + t * dx, fy = y1 + t * dy;
      const d = Math.sqrt((cx - fx) ** 2 + (cy - fy) ** 2);
      if (d < bestDist) { bestDist = d; bLat = fy / kLat; bLon = fx / kLon; }
    }
  }

  return bestDist < threshold ? L.latLng(bLat, bLon) : latlng;
}

// ── Zone constructible ────────────────────────────────────────────────────────

function _lineIntersect(
  a1: [number, number], a2: [number, number],
  b1: [number, number], b2: [number, number],
): [number, number] | null {
  const dx1 = a2[0] - a1[0], dy1 = a2[1] - a1[1];
  const dx2 = b2[0] - b1[0], dy2 = b2[1] - b1[1];
  const det = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(det) < 1e-10) return null;
  const t = ((b1[0] - a1[0]) * dy2 - (b1[1] - a1[1]) * dx2) / det;
  return [a1[0] + t * dx1, a1[1] + t * dy1];
}

function InvalidateSizeEffect({ fullscreen }: { fullscreen: boolean }) {
  const map = useMap();
  useEffect(() => {
    const recenter = () => {
      const c = map.getCenter();
      const z = map.getZoom();
      map.invalidateSize({ animate: false });
      map.setView(c, z, { animate: false });
    };
    const t1 = setTimeout(recenter, 50);
    const t2 = setTimeout(recenter, 200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [fullscreen, map]);
  return null;
}

function ZoneConstructibleLayer({
  parcelRing, access, rv, rl, rf, hasAnnexes, annexeRetraits,
}: {
  parcelRing: [number, number][] | null;
  access: { lat: number; lon: number } | null;
  rv: number; rl: number; rf: number;
  hasAnnexes: boolean;
  annexeRetraits?: { type: string; surfaceMaxM2?: number; hauteurMaxM?: number; enLimite: boolean }[];
}) {
  const map = useMap();
  const layersRef = useRef<L.Layer[]>([]);

  useEffect(() => {
    layersRef.current.forEach((l) => { try { map.removeLayer(l); } catch { /* */ } });
    layersRef.current = [];
    if (!parcelRing) return;

    const makeLabel = (lat: number, lon: number, color: string, text: string) => {
      const lbl = L.marker([lat, lon], {
        icon: L.divIcon({
          className: "",
          iconSize: [130, 18],
          iconAnchor: [65, 9],
          html: `<div style="background:${color};color:#fff;font-size:9px;font-weight:700;padding:1px 6px;border-radius:3px;text-align:center;white-space:nowrap;opacity:0.92">${text}</div>`,
        }),
        interactive: false, zIndexOffset: 500,
      }).addTo(map);
      layersRef.current.push(lbl);
    };

    // ── Zone constructible : offset uniforme rl sur tous les côtés ─────────────
    // Le retrait uniforme élimine naturellement la voie d'accès si < 2*rl.
    const nEdges = parcelRing.length - 1;
    const sbMain = Array<number>(nEdges).fill(rl);
    const zoneMain = computeOffsetPoly(parcelRing, sbMain);
    if (zoneMain) {
      const poly = L.polygon(zoneMain.map(([lat, lon]) => [lat, lon] as L.LatLngTuple), {
        color: "#16a34a", weight: 2, fillColor: "#16a34a", fillOpacity: 0.18,
        dashArray: "6 4", interactive: false,
      }).addTo(map);
      layersRef.current.push(poly);
      const cLat = zoneMain.reduce((s, [lat]) => s + lat, 0) / zoneMain.length;
      const cLon = zoneMain.reduce((s, [, lon]) => s + lon, 0) / zoneMain.length;
      makeLabel(cLat, cLon, "#16a34a", "Zone constructible");
    }

    // ── Zone annexes : jusqu'aux limites latérales/fond, retrait rv côté voie ───
    if (hasAnnexes) {
      const sbAnnex = classifyEdgeSetbacks(parcelRing, access, rv, 0, 0);
      const zoneAnnex = computeOffsetPoly(parcelRing, sbAnnex);
      if (zoneAnnex) {
        const outerRing = zoneAnnex.map(([lat, lon]) => [lat, lon] as L.LatLngTuple);
        // Anneau : trou = zone constructible (évite le chevauchement visuel)
        const rings: L.LatLngTuple[][] = zoneMain
          ? [outerRing, zoneMain.map(([lat, lon]) => [lat, lon] as L.LatLngTuple)]
          : [outerRing];
        const poly = L.polygon(rings, {
          color: "#0891b2", weight: 1.5, fillColor: "#0891b2", fillOpacity: 0.15,
          dashArray: "5 4", interactive: false,
        }).addTo(map);
        layersRef.current.push(poly);

        // Label : milieu d'un côté à setback=0 (latéral ou fond), légèrement décalé vers l'intérieur
        const nPts = parcelRing.length - 1;
        const pCLat = parcelRing.reduce((s, [, lat]) => s + lat, 0) / nPts;
        const pCLon = parcelRing.reduce((s, [lon]) => s + lon, 0) / nPts;
        let lLat = pCLat, lLon = pCLon;
        for (let i = 0; i < nPts; i++) {
          if (sbAnnex[i] === 0) {
            const [lon1, lat1] = parcelRing[i];
            const [lon2, lat2] = parcelRing[(i + 1) % nPts];
            const mLat = (lat1 + lat2) / 2, mLon = (lon1 + lon2) / 2;
            const kL = 111320, kN = _kLon(mLat);
            const dLat = (pCLat - mLat) * kL, dLon = (pCLon - mLon) * kN;
            const len = Math.sqrt(dLat * dLat + dLon * dLon);
            if (len > 0.01) {
              lLat = mLat + (dLat / len) * 1.5 / kL;
              lLon = mLon + (dLon / len) * 1.5 / kN;
            }
            break;
          }
        }
        // Résumé surface/hauteur max depuis le type "autre" ou premier type avec limites
        const refAnnexe = annexeRetraits?.find((r) => r.surfaceMaxM2 != null || r.hauteurMaxM != null);
        const annexeLabelParts = ["Zone annexes"];
        if (refAnnexe?.surfaceMaxM2 != null) annexeLabelParts.push(`max ${refAnnexe.surfaceMaxM2} m²`);
        if (refAnnexe?.hauteurMaxM != null) annexeLabelParts.push(`H ≤ ${refAnnexe.hauteurMaxM} m`);
        makeLabel(lLat, lLon, "#0891b2", annexeLabelParts.join(" · "));
      }
    }

    return () => {
      layersRef.current.forEach((l) => { try { map.removeLayer(l); } catch { /* */ } });
      layersRef.current = [];
    };
  }, [parcelRing, access, rv, rl, rf, hasAnnexes, map]);

  return null;
}

function ManualMeasureLayer({
  active,
  measures,
  onAddMeasure,
  parcelRing,
  obstacleRings = [],
}: {
  active: boolean;
  measures: ManualMeasure[];
  onAddMeasure: (m: ManualMeasure) => void;
  parcelRing: [number, number][] | null;
  obstacleRings?: [number, number][][]; // [lat, lon][][]
}) {
  const map = useMap();
  const startRef = useRef<[number, number] | null>(null);
  const previewRef = useRef<L.Layer[]>([]);
  const drawnRef = useRef<L.Layer[]>([]);
  const ringRef = useRef(parcelRing);
  const obstRef = useRef(obstacleRings);
  useEffect(() => { ringRef.current = parcelRing; }, [parcelRing]);
  useEffect(() => { obstRef.current = obstacleRings; }, [obstacleRings]);

  useEffect(() => {
    drawnRef.current.forEach((l) => { try { map.removeLayer(l); } catch { /* */ } });
    drawnRef.current = [];
    for (const m of measures) {
      const line = L.polyline([[m.from[0], m.from[1]], [m.to[0], m.to[1]]], {
        color: "#7c3aed", weight: 2, dashArray: "6 4", interactive: false,
      }).addTo(map);
      const mid: [number, number] = [(m.from[0] + m.to[0]) / 2, (m.from[1] + m.to[1]) / 2];
      const txt = m.dist < 10 ? m.dist.toFixed(2) : m.dist.toFixed(1);
      const lbl = L.marker(mid, {
        icon: L.divIcon({
          className: "",
          iconSize: [52, 18],
          iconAnchor: [26, 9],
          html: `<div style="background:#fff;border:1.5px solid #7c3aed;border-radius:3px;padding:1px 5px;font-size:10px;font-weight:700;color:#7c3aed;text-align:center;white-space:nowrap">${txt} m</div>`,
        }),
        interactive: false, zIndexOffset: 800,
      }).addTo(map);
      drawnRef.current.push(line, lbl);
    }
    return () => {
      drawnRef.current.forEach((l) => { try { map.removeLayer(l); } catch { /* */ } });
      drawnRef.current = [];
    };
  }, [measures, map]);

  useEffect(() => {
    if (!active) {
      startRef.current = null;
      previewRef.current.forEach((l) => { try { map.removeLayer(l); } catch { /* */ } });
      previewRef.current = [];
    }
  }, [active, map]);

  useMapEvents({
    click(e) {
      if (!active) return;
      L.DomEvent.stopPropagation(e);
      if (!startRef.current) {
        const from = snapFirstPoint(e.latlng, ringRef.current, obstRef.current);
        startRef.current = from;
        const dot = L.circleMarker([from[0], from[1]], {
          radius: 4, color: "#7c3aed", fillColor: "#7c3aed", fillOpacity: 1, weight: 2, interactive: false,
        }).addTo(map);
        const preview = L.polyline([[from[0], from[1]], [from[0], from[1]]], {
          color: "#7c3aed", weight: 2, dashArray: "6 4", opacity: 0.6, interactive: false,
        }).addTo(map);
        previewRef.current = [dot, preview];
      } else {
        const from = startRef.current;
        const to = snapSecondPoint(from, e.latlng, ringRef.current, obstRef.current);
        const kLat = 111320;
        const kLon = kLat * Math.cos(((from[0] + to[0]) / 2 * Math.PI) / 180);
        const dx = (to[1] - from[1]) * kLon;
        const dy = (to[0] - from[0]) * kLat;
        const dist = Math.sqrt(dx * dx + dy * dy);
        onAddMeasure({ id: `m${Date.now()}`, from, to, dist });
        startRef.current = null;
        previewRef.current.forEach((l) => { try { map.removeLayer(l); } catch { /* */ } });
        previewRef.current = [];
      }
    },
    mousemove(e) {
      if (!active || !startRef.current) return;
      const line = previewRef.current[1] as L.Polyline | undefined;
      if (line) {
        const to = snapSecondPoint(startRef.current, e.latlng, ringRef.current, obstRef.current);
        line.setLatLngs([[startRef.current[0], startRef.current[1]], [to[0], to[1]]]);
      }
    },
  });

  return null;
}

// Rendu simple des formes hors-emprise (parking non clos) — sans interaction ni côtes
function NonEmpriseLayer({ shapes }: { shapes: DrawnShape[] }) {
  const map = useMap();
  const layersRef = useRef<L.Layer[]>([]);

  useEffect(() => {
    layersRef.current.forEach((l) => { try { map.removeLayer(l); } catch { /* */ } });
    layersRef.current = [];
    for (const shape of shapes) {
      const poly = L.polygon(
        shape.polygon.map(([lat, lon]) => [lat, lon] as L.LatLngTuple),
        { color: "#f59e0b", weight: 2.5, fillColor: "#f59e0b", fillOpacity: 0.4, dashArray: "6 4" },
      );
      poly.addTo(map);
      poly.bindTooltip(
        `<div style="font-size:12px;font-weight:600">${shape.label}</div>`,
        { sticky: true },
      );
      layersRef.current.push(poly);
    }
    return () => {
      layersRef.current.forEach((l) => { try { map.removeLayer(l); } catch { /* */ } });
    };
  }, [shapes, map]);

  return null;
}

function DrawingLayer({
  drawMode, drawShapeType = "batiment", drawnShapes = [],
  onShapeDrawn, onShapeUpdated,
  parcelRing, editMode = null, existingBuildings = [], autoSelect = null,
}: {
  drawMode: boolean;
  drawShapeType?: string;
  drawnShapes?: DrawnShape[];
  onShapeDrawn?: (s: DrawnShape) => void;
  onShapeUpdated?: (id: string, polygon: [number, number][], surfaceM2: number) => void;
  parcelRing?: [number, number][] | null; // [lon, lat][]
  editMode?: "drag" | "rotate" | "vertex" | null;
  existingBuildings?: Building[];
  autoSelect?: { id: string; token: number } | null;
}) {
  const map = useMap();

  // ── Refs stables ────────────────────────────────────────────────────────────
  const layersRef = useRef(new Map<string, { poly: L.Polygon; cotes: L.Layer[] }>());
  const syncFnsRef = useRef(new Map<string, () => void>());
  const parcelRingRef = useRef(parcelRing);
  const onShapeUpdatedRef = useRef(onShapeUpdated);
  const existingBuildingsRef = useRef(existingBuildings);
  const drawnShapesRef = useRef(drawnShapes);
  const onShapeDrawnRef = useRef(onShapeDrawn);
  const drawShapeTypeRef = useRef(drawShapeType);
  useEffect(() => { parcelRingRef.current = parcelRing; }, [parcelRing]);
  useEffect(() => { onShapeUpdatedRef.current = onShapeUpdated; }, [onShapeUpdated]);
  useEffect(() => { existingBuildingsRef.current = existingBuildings; }, [existingBuildings]);
  useEffect(() => { drawnShapesRef.current = drawnShapes; }, [drawnShapes]);
  useEffect(() => { onShapeDrawnRef.current = onShapeDrawn; }, [onShapeDrawn]);
  useEffect(() => { drawShapeTypeRef.current = drawShapeType; }, [drawShapeType]);

  // ── Marqueurs de sommets (mode vertex) ──────────────────────────────────────
  const vertexMarkersRef = useRef(new Map<string, L.Marker[]>());
  const vertexSnapHlRef = useRef<L.CircleMarker | null>(null);

  // ── Snap de position (coins bâtiments + limites parcelle) ───────────────────
  const snapCornersRef = useRef<[number, number][]>([]);
  const snapEdgesRef = useRef<[[number, number], [number, number]][]>([]);
  const snapCandidateLayerRef = useRef<L.LayerGroup | null>(null);
  const snapHighlightRef = useRef<L.CircleMarker | null>(null);

  // ── État édition ────────────────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  const editModeRef = useRef(editMode);
  useEffect(() => { editModeRef.current = editMode; }, [editMode]);
  const drawModeRef = useRef(drawMode);
  useEffect(() => { drawModeRef.current = drawMode; }, [drawMode]);
  useEffect(() => { setSelectedId(null); }, [editMode]);
  useEffect(() => { if (autoSelect?.id) setSelectedId(autoSelect.id); }, [autoSelect]);

  // ── Côtes interactives (mode "vertex") ──────────────────────────────────────
  const [dimLabels, setDimLabels] = useState<{ edgeIdx: number; x: number; y: number; distM: number; angleDeg: number }[]>([]);
  const [dimEditingEdge, setDimEditingEdge] = useState<number | null>(null);
  const [dimEditValue, setDimEditValue] = useState("");
  const dimEditInputRef = useRef<HTMLInputElement | null>(null);

  // Calcul des positions pixel des labels (se met à jour au zoom/pan)
  useEffect(() => {
    if (editMode !== "vertex" || !selectedId) { setDimLabels([]); setDimEditingEdge(null); return; }
    const shape = drawnShapes.find((s) => s.id === selectedId);
    if (!shape) return;
    const poly = shape.polygon;
    const isClosedRing = poly.length > 1 && poly[0][0] === poly[poly.length - 1][0] && poly[0][1] === poly[poly.length - 1][1];
    const n = isClosedRing ? poly.length - 1 : poly.length;
    const kLat = 111320;
    const avgLat = poly.slice(0, n).reduce((s, [l]) => s + l, 0) / n;
    const kLon = kLat * Math.cos((avgLat * Math.PI) / 180);

    const compute = () => {
      const cLat = poly.slice(0, n).reduce((s, [l]) => s + l, 0) / n;
      const cLon = poly.slice(0, n).reduce((s, [, l]) => s + l, 0) / n;
      const centPx = map.latLngToContainerPoint([cLat, cLon]);
      const labels = Array.from({ length: n }, (_, i) => {
        const [lat1, lon1] = poly[i], [lat2, lon2] = poly[(i + 1) % n];
        const midLat = (lat1 + lat2) / 2, midLon = (lon1 + lon2) / 2;
        const midPx = map.latLngToContainerPoint([midLat, midLon]);
        const p1px = map.latLngToContainerPoint([lat1, lon1]);
        const p2px = map.latLngToContainerPoint([lat2, lon2]);
        // Angle de l'arête en coords écran, normalisé pour que le texte soit toujours lisible
        let angleDeg = Math.atan2(p2px.y - p1px.y, p2px.x - p1px.x) * 180 / Math.PI;
        if (angleDeg > 90 || angleDeg < -90) angleDeg += 180;
        const ox = centPx.x - midPx.x, oy = centPx.y - midPx.y;
        const ol = Math.sqrt(ox * ox + oy * oy);
        const dx = lon2 * kLon - lon1 * kLon, dy = lat2 * kLat - lat1 * kLat;
        return {
          edgeIdx: i,
          x: midPx.x + (ol > 0 ? (ox / ol) * 10 : 0),
          y: midPx.y + (ol > 0 ? (oy / ol) * 10 : 0),
          distM: Math.sqrt(dx * dx + dy * dy),
          angleDeg,
        };
      });
      setDimLabels(labels);
    };
    compute();
    map.on("move zoom", compute);
    return () => { map.off("move zoom", compute); };
  }, [editMode, selectedId, drawnShapes, map]);

  // Applique un changement de longueur sur une arête
  const applyEdgeDimChange = (shapeId: string, edgeIdx: number, newLenM: number) => {
    const shape = drawnShapesRef.current.find((s) => s.id === shapeId);
    if (!shape || newLenM < 0.1) return;
    const poly = shape.polygon;
    const isClosedRing = poly.length > 1 && poly[0][0] === poly[poly.length - 1][0] && poly[0][1] === poly[poly.length - 1][1];
    const n = isClosedRing ? poly.length - 1 : poly.length;
    const [lat1, lon1] = poly[edgeIdx], [lat2, lon2] = poly[(edgeIdx + 1) % n];
    const kLat = 111320, kLon = kLat * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
    const x1 = lon1 * kLon, y1 = lat1 * kLat, x2 = lon2 * kLon, y2 = lat2 * kLat;
    const curLen = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    if (curLen < 0.01) return;
    const ux = (x2 - x1) / curLen, uy = (y2 - y1) / curLen;
    const delta = newLenM - curLen;
    const newPts = poly.slice(0, n).map(([la, lo]) => [la, lo] as [number, number]);
    const idx1 = (edgeIdx + 1) % n;
    newPts[idx1] = [(y2 + delta * uy) / kLat, (x2 + delta * ux) / kLon];
    newPts.push(newPts[0]);
    onShapeUpdatedRef.current?.(shapeId, newPts, geoAreaM2(newPts.slice(0, n)));
    setDimEditingEdge(null);
  };

  // Affiche / masque les marqueurs de sommets selon le mode et la sélection
  useEffect(() => {
    if (editMode !== "vertex" || !selectedId) {
      removeAllVertexMarkers();
      return;
    }
    createVertexMarkersForShape(selectedId);
    return () => { removeAllVertexMarkers(); };
  }, [editMode, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── État dessin polygone ─────────────────────────────────────────────────────
  const verticesRef = useRef<[number, number][]>([]); // [lat, lon][]
  const previewPolyRef = useRef<L.Polyline | null>(null);
  const snapLinesRef = useRef<L.Polyline[]>([]);
  const firstMarkerRef = useRef<L.CircleMarker | null>(null);
  const snapDirsRef = useRef<number[]>([]); // angles en radians
  const currentMouseAngleRef = useRef<number>(0);
  const [drawing, setDrawing] = useState(false);
  const drawingRef = useRef(false);
  useEffect(() => { drawingRef.current = drawing; }, [drawing]);
  const [vertexCount, setVertexCount] = useState(0);
  const [liveInfo, setLiveInfo] = useState<{ angleDeg: number; distM: number; snapped: boolean } | null>(null);
  const [segLabel, setSegLabel] = useState<{ x: number; y: number; distM: number } | null>(null);
  const [exactLength, setExactLength] = useState("5");
  const exactLengthRef = useRef("5");
  useEffect(() => { exactLengthRef.current = exactLength; }, [exactLength]);
  const distInputRef = useRef<HTMLInputElement | null>(null);

  // Construire les candidats de snap quand la parcelle ou les bâtiments changent
  useEffect(() => {
    const corners: [number, number][] = [];
    const edges: [[number, number], [number, number]][] = [];
    if (parcelRing) {
      for (let i = 0; i < parcelRing.length - 1; i++) {
        const [lon1, lat1] = parcelRing[i];
        const [lon2, lat2] = parcelRing[i + 1];
        corners.push([lat1, lon1]);
        edges.push([[lat1, lon1], [lat2, lon2]]);
      }
    }
    for (const bldg of existingBuildings) {
      const ring = bldg.polygon;
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        corners.push(ring[i]);
        edges.push([ring[i], ring[(i + 1) % n]]);
      }
    }
    for (const shape of drawnShapes) {
      const ring = shape.polygon;
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        corners.push(ring[i]);
        edges.push([ring[i], ring[(i + 1) % n]]);
      }
    }
    snapCornersRef.current = corners;
    snapEdgesRef.current = edges;

    if (snapCandidateLayerRef.current) {
      try { map.removeLayer(snapCandidateLayerRef.current); } catch { /**/ }
      snapCandidateLayerRef.current = null;
    }
    if (drawMode) {
      const group = L.layerGroup();
      for (const [cLat, cLon] of corners) {
        L.circleMarker([cLat, cLon], {
          radius: 4, color: "#b45309", weight: 2, fillColor: "#fef3c7", fillOpacity: 0.95, interactive: false,
        }).addTo(group);
      }
      snapCandidateLayerRef.current = group;
      group.addTo(map);
    }
    return () => {
      if (snapCandidateLayerRef.current) {
        try { map.removeLayer(snapCandidateLayerRef.current); } catch { /**/ }
        snapCandidateLayerRef.current = null;
      }
    };
  }, [parcelRing, existingBuildings, drawnShapes, drawMode, map]);

  // Sync des layers Leaflet avec drawnShapes
  useEffect(() => {
    const ids = new Set(drawnShapes.map((s) => s.id));

    for (const [id, { poly, cotes }] of layersRef.current) {
      if (!ids.has(id)) {
        try { map.removeLayer(poly); } catch { /* */ }
        cotes.forEach((l) => { try { map.removeLayer(l); } catch { /* */ } });
        layersRef.current.delete(id);
        syncFnsRef.current.delete(id);
      }
    }

    for (const shape of drawnShapes) {
      if (!layersRef.current.has(shape.id)) {
        const isParking = shape.id === "parking-auto";
        const color = isParking
          ? "#f59e0b"
          : (shape.niveaux ? NIVEAUX_COLORS[shape.niveaux] : null) ?? SHAPE_COLORS[shape.type] ?? "#2563eb";
        const poly = L.polygon(
          shape.polygon.map(([lat, lon]) => [lat, lon] as L.LatLngTuple),
          {
            color,
            weight: isParking ? 2 : 2.5,
            fillColor: color,
            fillOpacity: isParking ? 0.35 : 0.25,
            dashArray: isParking ? "6 4" : undefined,
          },
        );
        poly.addTo(map);
        poly.bindTooltip(
          `<div style="font-size:12px;line-height:1.5"><b>${shape.label}</b><br/>${shape.surfaceM2} m²</div>`,
          { sticky: true },
        );

        const sync = () => {
          const ll = (poly.getLatLngs() as L.LatLng[][])[0];
          if (!ll?.length) return;
          const newPoly = ll.map((p) => [p.lat, p.lng] as [number, number]);
          const area = geoAreaM2(newPoly);
          poly.setTooltipContent(
            `<div style="font-size:12px;line-height:1.5"><b>${shape.label}</b><br/>${area} m²</div>`,
          );
          onShapeUpdatedRef.current?.(shape.id, newPoly, area);
          const entry = layersRef.current.get(shape.id);
          if (entry) {
            entry.cotes.forEach((l) => { try { map.removeLayer(l); } catch { /* */ } });
            entry.cotes = parcelRingRef.current
              ? [
                  ...buildCoteLines(newPoly, parcelRingRef.current, existingBuildingsRef.current.map((b) => b.polygon), (info) => handleCoteClick(shape.id, info)),
                  ...(!shape.nonEmprise ? buildMinDistIndicators(newPoly, parcelRingRef.current) : []),
                ]
              : [];
            entry.cotes.forEach((l) => l.addTo(map));
          }
        };
        syncFnsRef.current.set(shape.id, sync);

        // Clic → sélection (si en mode édition) ; en mode dessin on laisse passer
        poly.on("click", (e: L.LeafletMouseEvent) => {
          if (drawModeRef.current) return;
          L.DomEvent.stopPropagation(e);
          if (editModeRef.current !== null) setSelectedId(shape.id);
        });

        // Drag personnalisé (sans geoman)
        poly.on("mousedown", (e: L.LeafletMouseEvent) => {
          if (drawModeRef.current || editModeRef.current !== "drag") return;
          L.DomEvent.stopPropagation(e);
          if (selectedIdRef.current !== shape.id) return;
          map.dragging.disable();
          const startLat = e.latlng.lat, startLng = e.latlng.lng;
          const lls = (poly.getLatLngs() as L.LatLng[][])[0].map((ll) => [ll.lat, ll.lng] as [number, number]);
          let moved = false;
          const onMove = (ev: L.LeafletMouseEvent) => {
            moved = true;
            const dlat = ev.latlng.lat - startLat, dlng = ev.latlng.lng - startLng;
            poly.setLatLngs(lls.map((ll) => [ll[0] + dlat, ll[1] + dlng] as L.LatLngTuple));
          };
          const onUp = () => {
            map.dragging.enable();
            map.off("mousemove", onMove);
            map.off("mouseup", onUp);
            if (moved) sync();
          };
          map.on("mousemove", onMove);
          map.on("mouseup", onUp);
        });

        poly.on("mouseover", () => {
          const el = poly.getElement();
          if (!el) return;
          if (editModeRef.current === "drag") (el as HTMLElement).style.cursor = "move";
          else if (editModeRef.current === "vertex") (el as HTMLElement).style.cursor = "pointer";
        });
        poly.on("mouseout", () => {
          const el = poly.getElement();
          if (el) (el as HTMLElement).style.cursor = "";
        });

        const bRings = existingBuildings.map((b) => b.polygon);
        const cotes = (!shape.nonEmprise && parcelRing)
          ? [
              ...buildCoteLines(shape.polygon, parcelRing, bRings, (info) => handleCoteClick(shape.id, info)),
              ...buildMinDistIndicators(shape.polygon, parcelRing),
            ]
          : [];
        cotes.forEach((l) => l.addTo(map));
        layersRef.current.set(shape.id, { poly, cotes });
      } else {
        const entry = layersRef.current.get(shape.id)!;
        entry.poly.setLatLngs(shape.polygon.map(([lat, lon]) => [lat, lon] as L.LatLngTuple));
        entry.poly.setTooltipContent(
          `<div style="font-size:12px;line-height:1.5"><b>${shape.label}</b><br/>${shape.surfaceM2} m²</div>`,
        );
        entry.cotes.forEach((l) => { try { map.removeLayer(l); } catch { /* */ } });
        const bRings = existingBuildings.map((b) => b.polygon);
        entry.cotes = (!shape.nonEmprise && parcelRing)
          ? [
              ...buildCoteLines(shape.polygon, parcelRing, bRings, (info) => handleCoteClick(shape.id, info)),
              ...buildMinDistIndicators(shape.polygon, parcelRing),
            ]
          : [];
        entry.cotes.forEach((l) => l.addTo(map));
      }
    }
  }, [drawnShapes, map, parcelRing, onShapeUpdated]);

  // Nettoyage au démontage
  useEffect(() => () => {
    for (const { poly, cotes } of layersRef.current.values()) {
      try { map.removeLayer(poly); } catch { /* */ }
      cotes.forEach((l) => { try { map.removeLayer(l); } catch { /* */ } });
    }
  }, [map]);

  // ── Helpers dessin polygone ─────────────────────────────────────────────────

  const cleanupDrawingLayers = () => {
    if (previewPolyRef.current) { try { map.removeLayer(previewPolyRef.current); } catch { /**/ } previewPolyRef.current = null; }
    snapLinesRef.current.forEach((l) => { try { map.removeLayer(l); } catch { /**/ } });
    snapLinesRef.current = [];
    if (firstMarkerRef.current) { try { map.removeLayer(firstMarkerRef.current); } catch { /**/ } firstMarkerRef.current = null; }
    if (snapHighlightRef.current) { try { map.removeLayer(snapHighlightRef.current); } catch { /**/ } snapHighlightRef.current = null; }
  };

  // ── Gestion des marqueurs de sommets ────────────────────────────────────────

  const removeVertexMarkersForShape = (id: string) => {
    (vertexMarkersRef.current.get(id) ?? []).forEach((m) => { try { map.removeLayer(m); } catch { /**/ } });
    vertexMarkersRef.current.delete(id);
  };

  const removeAllVertexMarkers = () => {
    for (const id of [...vertexMarkersRef.current.keys()]) removeVertexMarkersForShape(id);
  };

  const createVertexMarkersForShape = (shapeId: string) => {
    removeVertexMarkersForShape(shapeId);
    const entry = layersRef.current.get(shapeId);
    if (!entry) return;
    const lls = (entry.poly.getLatLngs() as L.LatLng[][])[0];
    const markers = lls.map((ll, idx) => {
      const marker = L.marker([ll.lat, ll.lng], {
        icon: L.divIcon({
          className: "",
          iconSize: [14, 14],
          iconAnchor: [7, 7],
          html: '<div style="width:14px;height:14px;border-radius:3px;background:white;border:2.5px solid #1d4ed8;cursor:crosshair;box-shadow:0 1px 4px rgba(0,0,0,0.25)"></div>',
        }),
        draggable: true,
        autoPan: false,
        interactive: true,
        bubblingMouseEvents: false,
        zIndexOffset: 800,
      });
      marker.addTo(map);

      marker.on("drag", () => {
        const obstRings = [
          ...existingBuildingsRef.current.map((b) => b.polygon),
          ...drawnShapesRef.current.filter((s) => s.id !== shapeId).map((s) => s.polygon),
        ];
        const snapped = snapVertexPoint(marker.getLatLng(), parcelRingRef.current ?? null, obstRings);
        const currentLls = (entry.poly.getLatLngs() as L.LatLng[][])[0];
        entry.poly.setLatLngs([currentLls.map((p, i) => (i === idx ? snapped : p))]);
        // Highlight visuel si snap actif
        const isSnapped = snapped.lat !== marker.getLatLng().lat || snapped.lng !== marker.getLatLng().lng;
        if (isSnapped) {
          if (!vertexSnapHlRef.current) {
            vertexSnapHlRef.current = L.circleMarker([snapped.lat, snapped.lng], {
              radius: 8, color: "#f59e0b", weight: 2.5, fillColor: "#fef3c7", fillOpacity: 0.8, interactive: false,
            }).addTo(map);
          } else { vertexSnapHlRef.current.setLatLng(snapped); }
        } else {
          if (vertexSnapHlRef.current) { try { map.removeLayer(vertexSnapHlRef.current); } catch { /**/ } vertexSnapHlRef.current = null; }
        }
      });

      marker.on("dragend", () => {
        if (vertexSnapHlRef.current) { try { map.removeLayer(vertexSnapHlRef.current); } catch { /**/ } vertexSnapHlRef.current = null; }
        const obstRings = [
          ...existingBuildingsRef.current.map((b) => b.polygon),
          ...drawnShapesRef.current.filter((s) => s.id !== shapeId).map((s) => s.polygon),
        ];
        const snapped = snapVertexPoint(marker.getLatLng(), parcelRingRef.current ?? null, obstRings);
        marker.setLatLng(snapped);
        const currentLls = (entry.poly.getLatLngs() as L.LatLng[][])[0];
        entry.poly.setLatLngs([currentLls.map((p, i) => (i === idx ? snapped : p))]);
        syncFnsRef.current.get(shapeId)?.();
        const finalLls = (entry.poly.getLatLngs() as L.LatLng[][])[0];
        const currentMarkers = vertexMarkersRef.current.get(shapeId) ?? [];
        currentMarkers.forEach((m, i) => { if (finalLls[i]) m.setLatLng(finalLls[i]); });
      });

      return marker;
    });
    vertexMarkersRef.current.set(shapeId, markers);
  };

  const refreshSnapLines = (lastLat: number, lastLon: number) => {
    snapLinesRef.current.forEach((l) => { try { map.removeLayer(l); } catch { /**/ } });
    snapLinesRef.current = [];
    const kLat = 111320, kLon = kLat * Math.cos((lastLat * Math.PI) / 180);
    const D = 40;
    const dirs: { angle: number; color: string }[] = [];
    for (let i = 0; i < 8; i++) dirs.push({ angle: (i * Math.PI) / 4, color: "#94a3b8" });
    if (parcelRingRef.current) {
      const [pux, puy] = nearestEdgeDir(lastLon, lastLat, parcelRingRef.current);
      const ang = Math.atan2(pux * kLon, puy * kLat);
      dirs.push({ angle: ang, color: "#2563eb" });
      dirs.push({ angle: ang + Math.PI / 2, color: "#2563eb" });
      dirs.push({ angle: ang + Math.PI, color: "#2563eb" });
      dirs.push({ angle: ang + (3 * Math.PI) / 2, color: "#2563eb" });
    }
    // Directions des arêtes des bâtiments existants (guides orange)
    for (const bldg of existingBuildingsRef.current) {
      for (let i = 0; i < bldg.polygon.length - 1; i++) {
        const [bLat1, bLon1] = bldg.polygon[i], [bLat2, bLon2] = bldg.polygon[i + 1];
        const ang = Math.atan2((bLon2 - bLon1) * kLon, (bLat2 - bLat1) * kLat);
        dirs.push({ angle: ang, color: "#d97706" });
        dirs.push({ angle: ang + Math.PI / 2, color: "#d97706" });
        dirs.push({ angle: ang + Math.PI, color: "#d97706" });
        dirs.push({ angle: ang + (3 * Math.PI) / 2, color: "#d97706" });
      }
    }
    const verts = verticesRef.current;
    if (verts.length >= 2) {
      const [p1lat, p1lon] = verts[verts.length - 2], [p2lat, p2lon] = verts[verts.length - 1];
      const sdx = (p2lon - p1lon) * kLon, sdy = (p2lat - p1lat) * kLat;
      const ang = Math.atan2(sdx, sdy);
      dirs.push({ angle: ang, color: "#7c3aed" });
      dirs.push({ angle: ang + Math.PI / 2, color: "#7c3aed" });
      dirs.push({ angle: ang + Math.PI, color: "#7c3aed" });
      dirs.push({ angle: ang + (3 * Math.PI) / 2, color: "#7c3aed" });
    }
    // Guide vers le 1er sommet (fermeture) — en vert
    if (verts.length >= 3) {
      const [fLat, fLon] = verts[0];
      const fdx = (fLon - lastLon) * kLon, fdy = (fLat - lastLat) * kLat;
      dirs.push({ angle: Math.atan2(fdx, fdy), color: "#16a34a" });
    }
    const seen: number[] = [];
    for (const { angle, color } of dirs) {
      const a = ((angle % Math.PI) + Math.PI) % Math.PI;
      if (seen.some((b) => Math.abs(a - b) < 0.087)) continue;
      seen.push(a);
      const dlat = (D * Math.cos(angle)) / kLat, dlon = (D * Math.sin(angle)) / kLon;
      const line = L.polyline(
        [[lastLat - dlat, lastLon - dlon], [lastLat + dlat, lastLon + dlon]],
        { color, weight: 1, dashArray: "3 6", opacity: 0.3, interactive: false },
      );
      line.addTo(map);
      snapLinesRef.current.push(line);
    }
  };

  const computeSnap = (lat: number, lon: number) => {
    const verts = verticesRef.current;
    if (verts.length === 0) return { lat, lon, angleDeg: 0, distM: 0, snapped: false, positionSnapped: false };
    const [lastLat, lastLon] = verts[verts.length - 1];
    const kLat = 111320, kLon = kLat * Math.cos(((lastLat + lat) / 2) * Math.PI / 180);
    const dx = (lon - lastLon) * kLon, dy = (lat - lastLat) * kLat;
    const distM = Math.sqrt(dx * dx + dy * dy);
    const rawAngle = Math.atan2(dx, dy);

    // ── Snap de position : coins puis arêtes (priorité sur le snap directionnel) ─
    // 1. Coin le plus proche (rayon 0.4 m)
    let bestCornerDist = 0.4, snappedCorner: [number, number] | null = null;
    for (const [cLat, cLon] of snapCornersRef.current) {
      const d = distMeters(lat, lon, cLat, cLon);
      if (d < bestCornerDist) { bestCornerDist = d; snappedCorner = [cLat, cLon]; }
    }
    if (snappedCorner) {
      const [sLat, sLon] = snappedCorner;
      const sdx = (sLon - lastLon) * kLon, sdy = (sLat - lastLat) * kLat;
      const d = Math.sqrt(sdx * sdx + sdy * sdy);
      return { lat: sLat, lon: sLon, angleDeg: Math.atan2(sdx, sdy) * 180 / Math.PI, distM: d, snapped: true, positionSnapped: true };
    }

    // 2. Arête la plus proche (rayon 0.25 m)
    let bestEdgeDist = 0.25, snappedEdgePos: [number, number] | null = null;
    for (const [p1, p2] of snapEdgesRef.current) {
      const [p1lat, p1lon] = p1, [p2lat, p2lon] = p2;
      const eAvgLat = (p1lat + p2lat + lat) / 3;
      const ekLon = 111320 * Math.cos(eAvgLat * Math.PI / 180);
      const edx = (p2lon - p1lon) * ekLon, edy = (p2lat - p1lat) * 111320;
      const len2 = edx * edx + edy * edy;
      if (len2 < 1e-10) continue;
      const mx = (lon - p1lon) * ekLon, my = (lat - p1lat) * 111320;
      const t = Math.max(0, Math.min(1, (mx * edx + my * edy) / len2));
      const d = Math.hypot(mx - t * edx, my - t * edy);
      if (d < bestEdgeDist) {
        bestEdgeDist = d;
        snappedEdgePos = [p1lat + t * (p2lat - p1lat), p1lon + t * (p2lon - p1lon)];
      }
    }
    if (snappedEdgePos) {
      const [sLat, sLon] = snappedEdgePos;
      const sdx = (sLon - lastLon) * kLon, sdy = (sLat - lastLat) * kLat;
      const d = Math.sqrt(sdx * sdx + sdy * sdy);
      return { lat: sLat, lon: sLon, angleDeg: Math.atan2(sdx, sdy) * 180 / Math.PI, distM: d, snapped: true, positionSnapped: true };
    }

    // ── Snap directionnel (angles) ──────────────────────────────────────────────
    const candidates: number[] = [];
    for (let i = 0; i < 72; i++) candidates.push((i * Math.PI) / 36); // 5° grid
    if (parcelRingRef.current) {
      const [pux, puy] = nearestEdgeDir(lastLon, lastLat, parcelRingRef.current);
      const ang = Math.atan2(pux * kLon, puy * kLat);
      for (let k = 0; k < 4; k++) candidates.push(ang + (k * Math.PI) / 2);
    }
    for (const bldg of existingBuildingsRef.current) {
      for (let i = 0; i < bldg.polygon.length - 1; i++) {
        const [bLat1, bLon1] = bldg.polygon[i], [bLat2, bLon2] = bldg.polygon[i + 1];
        const ang = Math.atan2((bLon2 - bLon1) * kLon, (bLat2 - bLat1) * kLat);
        for (let k = 0; k < 4; k++) candidates.push(ang + (k * Math.PI) / 2);
      }
    }
    for (const shape of drawnShapesRef.current) {
      const n = shape.polygon.length;
      for (let i = 0; i < n - 1; i++) {
        const [sLat1, sLon1] = shape.polygon[i], [sLat2, sLon2] = shape.polygon[i + 1];
        const ang = Math.atan2((sLon2 - sLon1) * kLon, (sLat2 - sLat1) * kLat);
        for (let k = 0; k < 4; k++) candidates.push(ang + (k * Math.PI) / 2);
      }
    }
    if (verts.length >= 2) {
      const [p1lat, p1lon] = verts[verts.length - 2];
      const sdx = (lastLon - p1lon) * kLon, sdy = (lastLat - p1lat) * kLat;
      const ang = Math.atan2(sdx, sdy);
      for (let k = 0; k < 4; k++) candidates.push(ang + (k * Math.PI) / 2);
    }
    // Direction exacte vers le 1er sommet (aide la fermeture propre)
    if (verts.length >= 3) {
      const [fLat, fLon] = verts[0];
      const cdx = (fLon - lastLon) * kLon, cdy = (fLat - lastLat) * kLat;
      candidates.push(Math.atan2(cdx, cdy));
    }
    // Seuil adaptatif : max 10cm de déplacement linéaire, capé à 2.5° pour les courtes distances
    const SNAP_THR = distM > 0.5
      ? Math.min((2.5 * Math.PI) / 180, Math.atan(0.10 / distM))
      : (2.5 * Math.PI) / 180;
    let bestDiff = Infinity, bestAngle = rawAngle;
    for (const c of candidates) {
      for (const off of [0, Math.PI, -Math.PI]) {
        const diff = Math.abs(rawAngle - (c + off));
        if (diff < SNAP_THR && diff < bestDiff) { bestDiff = diff; bestAngle = c + off; }
      }
    }
    const snapped = bestDiff < SNAP_THR;
    const snapAngle = snapped ? bestAngle : rawAngle;
    return {
      lat: lastLat + (distM * Math.cos(snapAngle)) / kLat,
      lon: lastLon + (distM * Math.sin(snapAngle)) / kLon,
      angleDeg: (snapAngle * 180) / Math.PI,
      distM,
      snapped,
      positionSnapped: false,
    };
  };

  const cancelPolygon = () => {
    cleanupDrawingLayers();
    verticesRef.current = [];
    setDrawing(false);
    setVertexCount(0);
    setLiveInfo(null);
    setSegLabel(null);
  };

  const finalizePolygon = () => {
    const verts = verticesRef.current;
    if (verts.length < 3) { cancelPolygon(); return; }
    cleanupDrawingLayers();
    const area = geoAreaM2(verts);
    const shapeType = drawShapeTypeRef.current;
    onShapeDrawnRef.current?.({
      id: `shape-${Date.now()}`,
      type: shapeType,
      label: SHAPE_LABELS[shapeType] ?? "Forme",
      polygon: verts,
      surfaceM2: area,
    });
    verticesRef.current = [];
    setDrawing(false);
    setVertexCount(0);
    setLiveInfo(null);
    setSegLabel(null);
  };

  const addExactVertex = () => {
    const len = parseFloat(exactLengthRef.current);
    if (!isFinite(len) || len < 0.1) return;
    const verts = verticesRef.current;
    if (verts.length === 0) return;
    const [lastLat, lastLon] = verts[verts.length - 1];
    const angle = currentMouseAngleRef.current;
    const kLat = 111320, kLon = kLat * Math.cos((lastLat * Math.PI) / 180);
    const newLat = lastLat + (len * Math.cos(angle)) / kLat;
    const newLon = lastLon + (len * Math.sin(angle)) / kLon;
    verticesRef.current = [...verts, [newLat, newLon]];
    setVertexCount(verticesRef.current.length);
    refreshSnapLines(newLat, newLon);
    // Vider la distance et rendre la main à la souris pour le prochain segment
    setExactLength("");
    distInputRef.current?.blur();
  };

  // Rotation autour du centroïde en espace métrique
  const rotatePoly = (id: string, angleDeg: number) => {
    const entry = layersRef.current.get(id);
    if (!entry) return;
    const lls = (entry.poly.getLatLngs() as L.LatLng[][])[0];
    const nn = lls.length;
    const cLat = lls.reduce((s, ll) => s + ll.lat, 0) / nn;
    const cLon = lls.reduce((s, ll) => s + ll.lng, 0) / nn;
    const kLat = 111320, kLon = kLat * Math.cos((cLat * Math.PI) / 180);
    const rad = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    entry.poly.setLatLngs(lls.map((ll) => {
      const dx = (ll.lng - cLon) * kLon, dy = (ll.lat - cLat) * kLat;
      return [cLat + (dx * sin + dy * cos) / kLat, cLon + (dx * cos - dy * sin) / kLon] as L.LatLngTuple;
    }));
    syncFnsRef.current.get(id)?.();
  };

  // Déplacement d'une forme via saisie de distance sur une côte
  const handleCoteClick = (shapeId: string, info: CoteClickInfo) => {
    setSelectedId(shapeId);

    const container = document.createElement("div");
    container.style.cssText = "display:flex;align-items:center;gap:6px;padding:2px 0;font-family:system-ui,sans-serif";
    L.DomEvent.disableClickPropagation(container);

    const label = document.createElement("span");
    label.textContent = "Distance :";
    label.style.cssText = "font-size:11px;color:#6b7280;white-space:nowrap";

    const input = document.createElement("input") as HTMLInputElement;
    input.type = "number";
    input.min = "0.1";
    input.step = "0.1";
    input.max = "99";
    input.value = info.dist.toFixed(2);
    input.style.cssText = "width:58px;padding:2px 5px;border:1px solid #d1d5db;border-radius:4px;font-size:12px;text-align:center";

    const unit = document.createElement("span");
    unit.textContent = "m";
    unit.style.cssText = "font-size:11px;color:#6b7280";

    const btn = document.createElement("button") as HTMLButtonElement;
    btn.textContent = "OK";
    btn.style.cssText = "padding:2px 10px;background:#4f46e5;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600";

    container.append(label, input, unit, btn);

    const popup = L.popup({ closeButton: true, offset: [0, -10] })
      .setLatLng(info.latlng)
      .setContent(container)
      .openOn(map);

    const apply = () => {
      const target = parseFloat(input.value);
      if (!isFinite(target) || target < 0.1) return;
      const delta = info.dist - target;
      const entry = layersRef.current.get(shapeId);
      if (!entry) return;
      const lls = (entry.poly.getLatLngs() as L.LatLng[][])[0];
      const avgLat = lls.reduce((s, ll) => s + ll.lat, 0) / lls.length;
      const kLat = 111320, kLon = kLat * Math.cos((avgLat * Math.PI) / 180);
      entry.poly.setLatLngs(lls.map((ll) => [
        ll.lat + (delta * info.ny) / kLat,
        ll.lng + (delta * info.nx) / kLon,
      ] as L.LatLngTuple));
      syncFnsRef.current.get(shapeId)?.();
      popup.close();
    };

    btn.onclick = apply;
    input.onkeydown = (e) => { if (e.key === "Enter") apply(); if (e.key === "Escape") popup.close(); };
    setTimeout(() => { input.select(); input.focus(); }, 80);
  };

  // Refs stables pour éviter les closures périmées dans le listener clavier
  const cancelRef = useRef(cancelPolygon);
  const finalizeRef = useRef(finalizePolygon);
  const addExactVertexRef = useRef(addExactVertex);
  useEffect(() => { cancelRef.current = cancelPolygon; }); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { finalizeRef.current = finalizePolygon; }); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { addExactVertexRef.current = addExactVertex; }); // eslint-disable-line react-hooks/exhaustive-deps

  // Clavier : Échap = annuler, Entrée = segment (si distance) ou fermer le polygone
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!drawingRef.current) return;
      if (ev.key === "Escape") { cancelRef.current(); return; }
      if (ev.key === "Enter" && !(ev.target instanceof HTMLInputElement)) {
        // Si une distance valide est en mémoire → placer le segment dans la direction courante
        const len = parseFloat(exactLengthRef.current);
        if (isFinite(len) && len >= 0.1) { addExactVertexRef.current(); }
        else { finalizeRef.current(); }
        return;
      }
      // Capture directe des chiffres/point/backspace quand l'input n'est pas focalisé
      if (ev.target instanceof HTMLInputElement) return;
      if (/^[0-9]$/.test(ev.key)) {
        ev.preventDefault();
        const cur = exactLengthRef.current;
        const next = (cur === "" || cur === "0" || !cur) ? ev.key : cur + ev.key;
        setExactLength(next);
        setTimeout(() => distInputRef.current?.focus(), 0);
      } else if (ev.key === ".") {
        ev.preventDefault();
        const cur = exactLengthRef.current;
        if (!cur.includes(".")) { setExactLength((cur || "0") + "."); setTimeout(() => distInputRef.current?.focus(), 0); }
      } else if (ev.key === "Backspace") {
        ev.preventDefault();
        setExactLength((exactLengthRef.current || "").slice(0, -1));
        setTimeout(() => distInputRef.current?.focus(), 0);
      } else if (ev.key === "Delete") {
        ev.preventDefault();
        setExactLength("");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Curseur crosshair pendant le dessin
  useEffect(() => {
    map.getContainer().style.cursor = drawMode ? "crosshair" : "";
    if (!drawMode) cancelRef.current();
    return () => { map.getContainer().style.cursor = ""; };
  }, [drawMode, map]);

  // Nettoyage des couches de dessin en cours au démontage
  useEffect(() => () => {
    cleanupDrawingLayers();
    for (const id of [...vertexMarkersRef.current.keys()]) {
      (vertexMarkersRef.current.get(id) ?? []).forEach((m) => { try { map.removeLayer(m); } catch { /**/ } });
    }
    vertexMarkersRef.current.clear();
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps

  useMapEvents({
    click(e) {
      if (editModeRef.current !== null && !drawingRef.current) { setSelectedId(null); return; }
      if (!drawMode) return;
      const { lat, lng: lon } = e.latlng;
      const verts = verticesRef.current;
      if (verts.length === 0) {
        verticesRef.current = [[lat, lon]];
        setDrawing(true);
        setVertexCount(1);
        if (firstMarkerRef.current) { try { map.removeLayer(firstMarkerRef.current); } catch { /**/ } }
        firstMarkerRef.current = L.circleMarker([lat, lon], {
          radius: 6, color: "#1d4ed8", fillColor: "#fff", fillOpacity: 1, weight: 2, interactive: false,
        });
        firstMarkerRef.current.addTo(map);
        refreshSnapLines(lat, lon);
        return;
      }
      // Calculer d'abord la position finale (avec fixedLen si définie)
      const snap = computeSnap(lat, lon);
      const fixedLen = parseFloat(exactLengthRef.current);
      let finalLat = snap.lat, finalLon = snap.lon;
      if (isFinite(fixedLen) && fixedLen >= 0.1 && !snap.positionSnapped) {
        const [lastLat, lastLon] = verts[verts.length - 1];
        const angle = (snap.angleDeg * Math.PI) / 180;
        const kLat = 111320, kLon = kLat * Math.cos((lastLat * Math.PI) / 180);
        finalLat = lastLat + (fixedLen * Math.cos(angle)) / kLat;
        finalLon = lastLon + (fixedLen * Math.sin(angle)) / kLon;
      }
      // Auto-fermeture : vérifier sur la position corrigée, pas sur la souris brute
      const [fLat, fLon] = verts[0];
      if (verts.length >= 3 && distMeters(finalLat, finalLon, fLat, fLon) < 1.5) {
        finalizeRef.current();
        return;
      }
      verticesRef.current = [...verts, [finalLat, finalLon]];
      setVertexCount(verticesRef.current.length);
      refreshSnapLines(finalLat, finalLon);
    },
    mousemove(e) {
      if (!drawingRef.current) return;
      const { lat, lng: lon } = e.latlng;
      const verts = verticesRef.current;
      if (verts.length === 0) return;
      const snap = computeSnap(lat, lon);
      currentMouseAngleRef.current = (snap.angleDeg * Math.PI) / 180;
      // La longueur fixe verrouille la distance — ignorée si snap de position actif
      const fixedLen = parseFloat(exactLengthRef.current);
      let previewLat = snap.lat, previewLon = snap.lon, displayDist = snap.distM;
      if (isFinite(fixedLen) && fixedLen >= 0.1 && !snap.positionSnapped) {
        const [lastLat, lastLon] = verts[verts.length - 1];
        const angle = currentMouseAngleRef.current;
        const kLat = 111320, kLon = kLat * Math.cos((lastLat * Math.PI) / 180);
        previewLat = lastLat + (fixedLen * Math.cos(angle)) / kLat;
        previewLon = lastLon + (fixedLen * Math.sin(angle)) / kLon;
        displayDist = fixedLen;
      }
      // Marqueur visuel de snap de position (halo jaune)
      if (snap.positionSnapped) {
        if (!snapHighlightRef.current) {
          snapHighlightRef.current = L.circleMarker([snap.lat, snap.lon], {
            radius: 7, color: "#f59e0b", weight: 2.5, fillColor: "#fef3c7", fillOpacity: 0.8, interactive: false,
          }).addTo(map);
        } else {
          snapHighlightRef.current.setLatLng([snap.lat, snap.lon]);
        }
      } else if (snapHighlightRef.current) {
        try { map.removeLayer(snapHighlightRef.current); } catch { /**/ }
        snapHighlightRef.current = null;
      }
      // Snap visuel vers P1 : si le point prévisualisé est proche de P1, l'accrocher exactement
      if (verts.length >= 3) {
        const [fLat, fLon] = verts[0];
        if (distMeters(previewLat, previewLon, fLat, fLon) < 1.5) {
          previewLat = fLat;
          previewLon = fLon;
          displayDist = distMeters(verts[verts.length - 1][0], verts[verts.length - 1][1], fLat, fLon);
        }
      }
      setLiveInfo({ angleDeg: snap.angleDeg, distM: displayDist, snapped: snap.snapped });
      const previewPts: [number, number][] = [...verts, [previewLat, previewLon]];
      if (verts.length >= 2) previewPts.push(verts[0]);
      if (previewPolyRef.current) {
        previewPolyRef.current.setLatLngs(previewPts.map(([a, b]) => [a, b] as L.LatLngTuple));
      } else {
        previewPolyRef.current = L.polyline(previewPts.map(([a, b]) => [a, b] as L.LatLngTuple), {
          color: "#1d4ed8", weight: 2, dashArray: "6 4", opacity: 0.6, interactive: false,
        });
        previewPolyRef.current.addTo(map);
      }
      // Label flottant : près du curseur, en coordonnées écran
      const curPx = map.latLngToContainerPoint([previewLat, previewLon]);
      setSegLabel({ x: curPx.x, y: curPx.y, distM: displayDist });
    },
  });

  // ── Panneau dessin polygone ──────────────────────────────────────────────────
  if (drawMode || drawing) {
    return (
      <>
        {/* Label flottant près du curseur — non-rotatif, ne couvre pas la ligne */}
        {drawing && segLabel && (
          <div
            ref={(el) => {
              if (!el) return;
              L.DomEvent.disableClickPropagation(el);
              L.DomEvent.disableScrollPropagation(el);
              el.style.left = `${segLabel.x + 12}px`;
              el.style.top = `${segLabel.y - 24}px`;
            }}
            className="absolute z-[1001] pointer-events-none bg-white/95 border border-indigo-300 rounded px-2 py-0.5 text-[11px] font-mono text-indigo-700 shadow whitespace-nowrap"
          >
            {segLabel.distM < 10 ? segLabel.distM.toFixed(2) : segLabel.distM.toFixed(1)} m
          </div>
        )}

        {/* Barre de contrôle centrée en bas */}
        <div
          ref={(el) => { if (el) { L.DomEvent.disableClickPropagation(el); L.DomEvent.disableScrollPropagation(el); } }}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[1000] bg-white/95 backdrop-blur-sm border border-gray-200 rounded-xl shadow-lg px-3 py-1.5 flex items-center gap-2.5"
        >
          {!drawing ? (
            <span className="text-[11px] text-gray-400">Cliquez pour poser le 1er point</span>
          ) : (
            <>
              {/* Distance fixe */}
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-gray-400 font-medium">📏</span>
                <input
                  ref={distInputRef}
                  type="number" min="0.1" max="999" step="0.01"
                  value={exactLength}
                  onChange={(ev) => setExactLength(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter") { ev.preventDefault(); addExactVertexRef.current(); }
                    if (ev.key === "Escape") { ev.preventDefault(); cancelRef.current(); }
                    ev.stopPropagation();
                  }}
                  placeholder="—"
                  className={`w-16 text-[11px] font-mono text-center border rounded px-1 py-0.5 focus:outline-none transition-colors ${
                    exactLength && isFinite(parseFloat(exactLength)) && parseFloat(exactLength) >= 0.1
                      ? "text-indigo-700 border-indigo-400 bg-indigo-50 focus:border-indigo-600"
                      : "text-indigo-700 border-indigo-200 focus:border-indigo-400"
                  }`}
                  title="Distance fixe (m) — tapez, puis cliquez sur la carte pour placer le point"
                />
                <span className="text-[10px] text-gray-400">m</span>
                {exactLength && isFinite(parseFloat(exactLength)) && parseFloat(exactLength) >= 0.1 && (
                  <button
                    type="button"
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => setExactLength("")}
                    className="text-[9px] text-indigo-400 hover:text-indigo-700 leading-none ml-0.5"
                    title="Effacer la distance fixe"
                  >✕</button>
                )}
              </div>

              {/* Angle snap */}
              {liveInfo && (
                <span className={`text-[11px] font-mono tabular-nums ${liveInfo.snapped ? "text-green-600 font-semibold" : "text-gray-400"}`}>
                  {(Math.round(liveInfo.angleDeg / 5) * 5 + 360) % 360}°
                  {liveInfo.snapped && <span className="ml-0.5">⊙</span>}
                </span>
              )}

              {/* Nb de points */}
              <span className="text-[10px] text-gray-300">|</span>
              <span className="text-[10px] text-gray-400">{vertexCount} pts</span>

              {/* Bouton fermer */}
              {vertexCount >= 3 && (
                <button
                  type="button"
                  onClick={() => finalizeRef.current()}
                  className="text-[11px] font-semibold text-green-700 border border-green-300 rounded px-2 py-0.5 hover:bg-green-50 transition-colors"
                  title="Fermer la polyligne (Entrée)"
                >
                  Fermer ↵
                </button>
              )}

              {/* Annuler */}
              <button
                type="button"
                onClick={() => cancelRef.current()}
                className="text-gray-400 hover:text-gray-600 text-base leading-none ml-0.5"
                title="Annuler (Échap)"
              >✕</button>
            </>
          )}
        </div>
      </>
    );
  }

  // ── Panneau sélection / édition ──
  const selectedShape = selectedId ? drawnShapes.find((s) => s.id === selectedId) : null;
  if (selectedShape && editMode !== null) {
    return (
      <>
        {/* Panneau latéral */}
        <div
          ref={(el) => { if (el) L.DomEvent.disableClickPropagation(el); }}
          className="absolute top-14 right-2 z-[1000] bg-white border border-gray-200 rounded-xl shadow-lg p-4 w-56"
        >
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <span className={`w-3 h-3 rounded-full flex-shrink-0 ${SHAPE_DOT_CLS[selectedShape.type] ?? "bg-blue-600"}`} />
              <span className="text-sm font-semibold text-gray-800">{selectedShape.label}</span>
            </div>
            <button type="button" onClick={() => setSelectedId(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none ml-2">×</button>
          </div>
          <p className="text-xs text-gray-400 mb-3">{selectedShape.surfaceM2} m²</p>
          {editMode === "drag" && (
            <p className="text-xs text-gray-500 italic">Cliquez et glissez la forme sur la carte.</p>
          )}
          {editMode === "vertex" && (
            <p className="text-xs text-gray-500 italic">Cliquez une côte pour saisir une dimension exacte, ou glissez les poignées.</p>
          )}
          {editMode === "rotate" && (
            <div>
              <p className="text-xs text-gray-500 font-medium mb-2">Rotation :</p>
              <div className="flex flex-wrap gap-1.5">
                {([-90, -45, -15, -5, +5, +15, +45, +90] as const).map((a) => (
                  <button key={a} type="button" onClick={() => rotatePoly(selectedShape.id, a)}
                    className="text-xs px-2.5 py-1 border border-gray-200 rounded hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 transition-colors">
                    {a > 0 ? "+" : ""}{a}°
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Côtes interactives à l'intérieur de la forme (mode dimensions) */}
        {editMode === "vertex" && dimLabels.map(({ edgeIdx, x, y, distM, angleDeg }) => (
          <div
            key={edgeIdx}
            ref={(el) => {
              if (!el) return;
              L.DomEvent.disableClickPropagation(el);
              L.DomEvent.disableScrollPropagation(el);
              el.style.left = `${x}px`;
              el.style.top = `${y}px`;
              el.style.transform = `translate(-50%,-50%) rotate(${angleDeg}deg)`;
            }}
            className="absolute z-[1002] pointer-events-auto"
          >
            {dimEditingEdge === edgeIdx ? (
              <input
                ref={dimEditInputRef}
                type="number"
                min="0.1"
                step="0.05"
                title="Longueur en mètres"
                placeholder={distM.toFixed(2)}
                value={dimEditValue}
                onChange={(e) => setDimEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const v = parseFloat(dimEditValue);
                    if (isFinite(v) && v >= 0.1) applyEdgeDimChange(selectedShape.id, edgeIdx, v);
                    else setDimEditingEdge(null);
                  }
                  if (e.key === "Escape") setDimEditingEdge(null);
                }}
                onBlur={() => {
                  const v = parseFloat(dimEditValue);
                  if (isFinite(v) && v >= 0.1) applyEdgeDimChange(selectedShape.id, edgeIdx, v);
                  else setDimEditingEdge(null);
                }}
                className="w-12 text-center text-[8px] font-mono border border-slate-400 rounded px-1 py-0 bg-white shadow-md outline-none"
                autoFocus
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setDimEditingEdge(edgeIdx);
                  setDimEditValue(distM.toFixed(2));
                  setTimeout(() => { dimEditInputRef.current?.focus(); dimEditInputRef.current?.select(); }, 0);
                }}
                className="text-[8px] font-mono bg-white/90 border border-slate-300 text-slate-500 rounded px-1.5 py-0 shadow hover:bg-slate-50 hover:border-slate-500 hover:text-slate-700 transition-colors cursor-pointer whitespace-nowrap"
              >
                {distM < 10 ? distM.toFixed(2) : distM.toFixed(1)} m
              </button>
            )}
          </div>
        ))}
      </>
    );
  }

  return null;
}

// ── Couche parcelles interactive ─────────────────────────────────────────────

function ParcelsLayer({ onParcelSelect }: { onParcelSelect: (f: GeoFeature) => void }) {
  const map = useMap();
  const [features, setFeatures] = useState<GeoFeature[]>([]);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(map.getZoom());

  async function loadParcels() {
    const z = map.getZoom();
    setZoom(z);
    if (z < 16) { setFeatures([]); return; }

    const b = map.getBounds();
    const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()},CRS:84`;
    setLoading(true);
    try {
      const qs = [
        "SERVICE=WFS", "VERSION=2.0.0", "REQUEST=GetFeature",
        "outputFormat=application%2Fjson",
        "typeName=CADASTRALPARCELS.PARCELLAIRE_EXPRESS%3Aparcelle",
        "count=300", "SRSNAME=CRS%3A84",
        `BBOX=${encodeURIComponent(bbox)}`,
      ].join("&");
      const res = await fetch(`https://data.geopf.fr/wfs/ows?${qs}`);
      if (res.ok) {
        const data = await res.json();
        setFeatures(data.features ?? []);
      }
    } catch { setFeatures([]); }
    setLoading(false);
  }

  useMapEvents({ moveend: loadParcels, zoomend: loadParcels });
  useEffect(() => { loadParcels(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (zoom < 16) return null;

  return (
    <>
      {loading && (
        <div className="leaflet-top leaflet-right pointer-events-none">
          <div className="leaflet-control m-2 bg-white px-2 py-1 text-xs text-gray-500 rounded shadow">
            Chargement des parcelles…
          </div>
        </div>
      )}
      {features.length > 0 && (
        <GeoJSON
          key={features.length + String(features[0]?.properties?.idu ?? "")}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data={{ type: "FeatureCollection" as const, features } as any}
          style={{ color: "#888", weight: 1, fillColor: "transparent", fillOpacity: 0 }}
          onEachFeature={(feature, layer) => {
            (layer.options as Record<string, unknown>).pmIgnore = true;
            layer.on({
              click: () => onParcelSelect(feature as GeoFeature),
              mouseover: (e) => { e.target.setStyle({ fillColor: "#7a9478", fillOpacity: 0.15 }); },
              mouseout: (e) => { e.target.setStyle({ fillColor: "transparent", fillOpacity: 0 }); },
            });
          }}
        />
      )}
    </>
  );
}

// ── Recentrage automatique ───────────────────────────────────────────────────

function FlyTo({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(center, zoom, { duration: 1 });
  }, [center, zoom, map]);
  return null;
}

// ── Composant principal ──────────────────────────────────────────────────────

export default function MapPicker({
  center, zoom, selectedFeature, onParcelSelect,
  lotPolygons, selectedLotId, onLotSelect,
  accessMode = false, accessPoint = null, onAccessPointSet,
  existingBuildings,
  drawMode = false, drawShapeType = "batiment", drawnShapes = [], onShapeDrawn, onShapeUpdated,
  editMode = null,
  editSelectKey = null,
  readOnlyShapes,
  showReadOnlyCotes = false,
  measureMode = false,
  manualMeasures = [],
  onAddManualMeasure,
  zoneConstructible = null,
  fullscreen = false,
  onToggleFullscreen,
  overlayPanel,
}: Props) {
  const selectedGeoJSON = selectedFeature
    ? { type: "Feature" as const, properties: {}, geometry: selectedFeature.geometry }
    : null;

  // Anneau de la parcelle sélectionnée en [lon, lat][] (GeoJSON) pour le snap et les côtes
  const parcelRing = useMemo<[number, number][] | null>(() => {
    // Priorité : lots (partagent tous la parcelle mère)
    if (lotPolygons && lotPolygons.length > 0 && lotPolygons[0].polygon.length >= 3)
      return lotPolygons[0].polygon.map(([lat, lon]) => [lon, lat] as [number, number]);
    if (!selectedFeature?.geometry) return null;
    const g = selectedFeature.geometry;
    if (g.type === "Polygon") return (g.coordinates as [number, number][][])[0];
    if (g.type === "MultiPolygon") return (g.coordinates as [number, number][][][])[0][0];
    return null;
  }, [selectedFeature, lotPolygons]);

  // Rings obstacles pour le snap de la mesure manuelle (bâtiments existants + formes dessinées)
  const obstacleRings = useMemo<[number, number][][]>(() => [
    ...(existingBuildings?.map((b) => b.polygon) ?? []),
    ...(readOnlyShapes?.map((s) => s.polygon) ?? []),
  ], [existingBuildings, readOnlyShapes]);

  // Lots → GeoJSON (filtre les polygones vides)
  const validLots = lotPolygons?.filter((l) => l.polygon.length >= 3) ?? [];
  const lotGeoJSON = validLots.length > 0
    ? {
        type: "FeatureCollection" as const,
        features: validLots.map((lot) => {
          const ring = lot.polygon.map(([lat, lon]) => [lon, lat] as [number, number]);
          ring.push(ring[0]);
          return {
            type: "Feature" as const,
            properties: { id: lot.id, surface: lot.surface },
            geometry: { type: "Polygon" as const, coordinates: [ring] },
          };
        }),
      }
    : null;

  return (
    <div className={fullscreen ? "fixed inset-0 z-[9999] bg-white" : "relative"}>
      {overlayPanel && !fullscreen && (
        <div
          className="absolute top-2 left-2 z-[1001] pointer-events-none"
        >
          <div
            className="pointer-events-auto"
            onWheel={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {overlayPanel}
          </div>
        </div>
      )}
      {overlayPanel && fullscreen && createPortal(
        <div
          className="fixed top-2 left-2 z-[99999] pointer-events-none"
        >
          <div
            className="pointer-events-auto"
            onWheel={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {overlayPanel}
          </div>
        </div>,
        document.body
      )}
      {accessMode && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[1000] bg-blue-700 text-white text-xs font-semibold px-4 py-1.5 rounded-full shadow-lg pointer-events-none">
          Cliquez sur le bord de la parcelle pour placer l&apos;accès
        </div>
      )}
      {drawMode && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[1000] bg-indigo-600 text-white text-xs font-semibold px-4 py-1.5 rounded-full shadow-lg pointer-events-none">
          Cliquez pour placer les sommets · Cliquez près du 1er point pour fermer
        </div>
      )}
      {onToggleFullscreen && (
        <button
          type="button"
          onClick={onToggleFullscreen}
          className="absolute bottom-8 right-2 z-[1001] bg-white border border-gray-300 rounded px-2 py-1 text-sm text-gray-600 hover:bg-gray-50 shadow leading-none"
          title={fullscreen ? "Réduire" : "Plein écran"}
        >
          {fullscreen ? "⊡" : "⊞"}
        </button>
      )}

      <MapContainer
        center={center}
        zoom={zoom}
        maxZoom={23}
        className={`w-full rounded-sm border border-warm-gray ${fullscreen ? "h-screen" : "h-[520px]"}`}
        scrollWheelZoom
      >
        <InvalidateSizeEffect fullscreen={fullscreen} />
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          maxNativeZoom={19}
          maxZoom={23}
        />

        <TileLayer
          url="https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=CADASTRALPARCELS.PARCELLAIRE_EXPRESS&STYLE=bdparcellaire&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}"
          attribution="IGN — Géoplateforme"
          opacity={0.5}
          minZoom={17}
          maxZoom={23}
          minNativeZoom={17}
          maxNativeZoom={18}
        />

        <ParcelsLayer onParcelSelect={onParcelSelect} />

        {/* Lots (plan de division) */}
        {lotGeoJSON && (
          <GeoJSON
            key={JSON.stringify(validLots.map((l) => l.id + selectedLotId))}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data={lotGeoJSON as any}
            style={(feature) => {
              const isSelected = feature?.properties?.id === selectedLotId;
              return {
                color: isSelected ? "#4f46e5" : "#7c3aed",
                weight: isSelected ? 3 : 2,
                fillColor: "#6366f1",
                fillOpacity: isSelected ? 0.4 : 0.15,
              };
            }}
            onEachFeature={(feature, layer) => {
              (layer.options as Record<string, unknown>).pmIgnore = true;
              if (onLotSelect) {
                layer.on({
                  click: () => {
                    const lot = lotPolygons!.find((l) => l.id === feature.properties.id);
                    if (lot) onLotSelect(lot);
                  },
                  mouseover: (e) => { e.target.setStyle({ fillOpacity: 0.3 }); },
                  mouseout: (e) => {
                    e.target.setStyle({ fillOpacity: feature.properties.id === selectedLotId ? 0.4 : 0.15 });
                  },
                });
              }
            }}
          />
        )}

        {/* Parcelle sélectionnée en surbrillance */}
        {selectedGeoJSON && !lotGeoJSON && (
          <GeoJSON
            key={JSON.stringify(selectedFeature?.properties?.idu)}
            data={selectedGeoJSON}
            style={{ color: "#7a9478", weight: 3, fillColor: "#7a9478", fillOpacity: 0.3 }}
            onEachFeature={(_, layer) => { (layer.options as Record<string, unknown>).pmIgnore = true; }}
          />
        )}

        {/* Constructions existantes BDTOPO (orange) */}
        {existingBuildings && existingBuildings.length > 0 && (
          <GeoJSON
            key={existingBuildings.map((b) => b.footprintM2).join(",")}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data={{
              type: "FeatureCollection",
              features: existingBuildings.map((b, i) => ({
                type: "Feature",
                properties: { usage: b.usage, hauteur: b.hauteur, nbEtages: b.nbEtages, surface: b.footprintM2 },
                geometry: {
                  type: "Polygon",
                  coordinates: [b.polygon.map(([lat, lon]) => [lon, lat])],
                },
                id: i,
              })),
            } as any}
            style={{ color: "#b45309", weight: 2, fillColor: "#f59e0b", fillOpacity: 0.5 }}
            onEachFeature={(feature, layer) => {
              (layer.options as Record<string, unknown>).pmIgnore = true;
              const p = feature.properties;
              layer.bindTooltip(
                `<div class="text-xs leading-snug">
                  <b>${p.usage ?? "Bâtiment"}</b><br/>
                  ${p.surface} m² · ${p.hauteur} m · ${p.nbEtages} étage${p.nbEtages > 1 ? "s" : ""}
                </div>`,
                { sticky: true }
              );
            }}
          />
        )}

        {/* Flèche d'accès */}
        <AccessLayer
          parcelGeometry={selectedFeature?.geometry ?? null}
          accessMode={accessMode}
          accessPoint={accessPoint ?? null}
          onAccessPointSet={onAccessPointSet ?? (() => {})}
        />

        {/* Formes hors-emprise (parking non clos) — rendu simple sans interaction */}
        <NonEmpriseLayer shapes={(drawnShapes ?? []).filter((s) => s.nonEmprise)} />

        {/* Dessin de projet — formes éditables uniquement */}
        <DrawingLayer
          drawMode={drawMode}
          drawShapeType={drawShapeType}
          drawnShapes={(drawnShapes ?? []).filter((s) => !s.nonEmprise)}
          onShapeDrawn={onShapeDrawn}
          onShapeUpdated={onShapeUpdated}
          parcelRing={parcelRing}
          editMode={editMode}
          existingBuildings={existingBuildings}
          autoSelect={editSelectKey}
        />

        {/* Formes en lecture seule (step 4) — rendu déclaratif, aucune interaction */}
        {readOnlyShapes && readOnlyShapes.length > 0 && (
          <GeoJSON
            key={readOnlyShapes.map((s) => s.id).join(",")}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data={{
              type: "FeatureCollection",
              features: readOnlyShapes.map((s) => ({
                type: "Feature",
                properties: { label: s.label, surface: s.surfaceM2, type: s.type, nonEmprise: s.nonEmprise },
                geometry: {
                  type: "Polygon",
                  coordinates: [s.polygon.map(([lat, lon]) => [lon, lat])],
                },
              })),
            } as any}
            style={(feature) => {
              if (feature?.properties?.nonEmprise) return { color: "#f59e0b", weight: 2.5, fillColor: "#f59e0b", fillOpacity: 0.4, dashArray: "6 4" };
              const color = SHAPE_COLORS[feature?.properties?.type ?? "batiment"] ?? "#2563eb";
              return { color, weight: 2.5, fillColor: color, fillOpacity: 0.3 };
            }}
            onEachFeature={(feature, layer) => {
              layer.bindTooltip(
                `<div style="font-size:12px;line-height:1.5"><b>${feature.properties?.label}</b><br/>${feature.properties?.surface} m²</div>`,
                { sticky: true },
              );
            }}
          />
        )}

        {showReadOnlyCotes && readOnlyShapes && readOnlyShapes.length > 0 && (
          <ReadOnlyCotesLayer
            shapes={readOnlyShapes}
            parcelRing={parcelRing}
            existingBuildings={existingBuildings}
          />
        )}

        <ManualMeasureLayer
          active={measureMode}
          measures={manualMeasures}
          onAddMeasure={onAddManualMeasure ?? (() => {})}
          parcelRing={parcelRing}
          obstacleRings={obstacleRings}
        />

        {zoneConstructible && (
          <ZoneConstructibleLayer
            parcelRing={parcelRing}
            access={accessPoint ? { lat: accessPoint.lat, lon: accessPoint.lon } : null}
            rv={zoneConstructible.rv}
            rl={zoneConstructible.rl}
            rf={zoneConstructible.rf}
            hasAnnexes={zoneConstructible.hasAnnexes}
            annexeRetraits={zoneConstructible.annexeRetraits}
          />
        )}

        <FlyTo center={center} zoom={zoom} />
      </MapContainer>

      {lotGeoJSON ? (
        <p className="text-[11px] text-muted mt-1.5">
          Lots extraits du plan de division (en violet). Cliquez sur votre lot pour le sélectionner.
        </p>
      ) : (
        <p className="text-[11px] text-muted mt-1.5">
          Zoomez jusqu&apos;au niveau de la rue pour voir les parcelles, puis cliquez sur la vôtre.
        </p>
      )}
    </div>
  );
}
