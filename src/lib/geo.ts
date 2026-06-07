// Géométrie, snap et cotations pour Metaplans
// Convention: polygones app = [lat, lon][], anneaux GeoJSON/WFS = [lon, lat][]

import * as turf from "@turf/turf";
import type { Feature, Polygon } from "geojson";

export const K_LAT = 111320;

export function kLon(lat: number): number {
  return K_LAT * Math.cos((lat * Math.PI) / 180);
}

// ── Convertisseurs Turf (privés) ───────────────────────────────────────────────
// Turf travaille en GeoJSON [lon, lat] — nos polygones app sont en [lat, lon]

function appPolyToTurf(poly: [number, number][]): Feature<Polygon> {
  const ring = poly.map(([lat, lon]) => [lon, lat] as [number, number]);
  return turf.polygon([[...ring, ring[0]]]);
}

function turfPolyToApp(feat: Feature<Polygon>): [number, number][] {
  return (feat.geometry.coordinates[0] as [number, number][])
    .slice(0, -1)
    .map(([lon, lat]) => [lat, lon] as [number, number]);
}

// Anneau GeoJSON [lon, lat][] → Feature Turf (ferme l'anneau si besoin)
function geoRingToTurf(ring: [number, number][]): Feature<Polygon> {
  const first = ring[0], last = ring[ring.length - 1];
  const closed = (first[0] === last[0] && first[1] === last[1]) ? ring : [...ring, first];
  return turf.polygon([closed]);
}

// Aire d'un polygone [lat, lon][] en m² — via Turf (WGS84 précis)
export function areaM2(poly: [number, number][]): number {
  if (poly.length < 3) return 0;
  return turf.area(appPolyToTurf(poly));
}

// Aire intérieure nette après offset mur vers l'intérieur (surface de plancher légale).
// wallThicknessM : épaisseur totale des murs en mètres (défaut 0.36 m).
export function interiorAreaM2(poly: [number, number][], wallThicknessM = 0.36): number {
  if (poly.length < 3) return 0;
  const inset = turf.buffer(appPolyToTurf(poly), -wallThicknessM, { units: "meters" });
  if (!inset) return 0;
  return Math.max(0, turf.area(inset));
}

// Distance en mètres entre deux points [lat, lon]
export function distM(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const kl = kLon((lat1 + lat2) / 2);
  return Math.sqrt(((lat2 - lat1) * K_LAT) ** 2 + ((lon2 - lon1) * kl) ** 2);
}

// Format distance lisible
export function fmtDist(m: number): string {
  if (m < 0.1) return `${(m * 100).toFixed(0)} cm`;
  if (m < 10)  return `${m.toFixed(2)} m`;
  return `${m.toFixed(1)} m`;
}

// ── Rectangle orienté ──────────────────────────────────────────────────────────
// Construit un rectangle à angles droits à partir de deux points et d'une direction
// ux, uy : direction en espace lon/lat
// Retourne [lat, lon][]
export function buildRotatedRect(
  aLon: number, aLat: number,
  bLon: number, bLat: number,
  ux: number, uy: number,
): [number, number][] {
  const avgLat = (aLat + bLat) / 2;
  const kl = kLon(avgLat);
  const ex = ux * kl, ey = uy * K_LAT;
  const eLen = Math.sqrt(ex * ex + ey * ey);
  if (eLen < 1e-10) return [];
  const enx = ex / eLen, eny = ey / eLen;
  const pnx = -eny, pny = enx;
  const abx = (bLon - aLon) * kl;
  const aby = (bLat - aLat) * K_LAT;
  const t = abx * enx + aby * eny;
  const s = abx * pnx + aby * pny;
  return [
    [aLat,                                       aLon                                      ],
    [aLat + (t * eny) / K_LAT,                   aLon + (t * enx) / kl                     ],
    [aLat + (t * eny + s * pny) / K_LAT,         aLon + (t * enx + s * pnx) / kl           ],
    [aLat + (s * pny) / K_LAT,                   aLon + (s * pnx) / kl                     ],
  ];
}

// Direction de l'arête la plus proche d'un point (anneau GeoJSON [lon, lat][])
export function nearestEdgeDir(
  lon: number, lat: number,
  ring: [number, number][],
): [number, number] {
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

// ── Snap ──────────────────────────────────────────────────────────────────────

export type SnapType = "corner" | "edge" | "angle" | "perp" | "perp-seg" | "close" | "free";

export interface SnapResult {
  lat: number;
  lon: number;
  type: SnapType;
  angleDeg?: number;
  color?: string;
}

export interface SnapConfig {
  corners:   boolean; // coins parcelle + surfaces
  edges:     boolean; // arêtes parcelle
  angles:    boolean; // grille 5°
  perpLimit: boolean; // perpendiculaire aux arêtes de la parcelle
  perpSeg:   boolean; // perpendiculaire au segment précédent
}

export const DEFAULT_SNAP_CONFIG: SnapConfig = {
  corners: true, edges: true, angles: true, perpLimit: true, perpSeg: true,
};

// Snap complet pour le mode dessin
// parcelRing : [lon, lat][] (GeoJSON)
// obstacles  : [lat, lon][][] (bâtiments)
// vertices   : [lat, lon][] (sommets déjà placés)
export function computeSnap(
  lat: number,
  lon: number,
  parcelRing: [number, number][] | null,
  obstacles: [number, number][][],
  vertices: [number, number][],
  toleranceM = 0.4,
  config: SnapConfig = DEFAULT_SNAP_CONFIG,
): SnapResult {
  const kl = kLon(lat);
  const cx = lon * kl, cy = lat * K_LAT;

  const cornerR = toleranceM;
  const edgeR   = toleranceM * 0.7;

  // ── 1. Snap de position : coins parcelle ─────────────────────────────────────
  if (config.corners && parcelRing) {
    let best = cornerR;
    let bLat = lat, bLon = lon;
    for (const [pLon, pLat] of parcelRing) {
      const d = Math.hypot(pLon * kl - cx, pLat * K_LAT - cy);
      if (d < best) { best = d; bLat = pLat; bLon = pLon; }
    }
    if (best < cornerR) return { lat: bLat, lon: bLon, type: "corner" };
  }

  // ── 2. Snap de position : coins surfaces dessinées ───────────────────────────
  if (config.corners) {
    let best = cornerR;
    let bLat = lat, bLon = lon;
    for (const ring of obstacles) {
      for (const [bLat2, bLon2] of ring) {
        const d = Math.hypot(bLon2 * kl - cx, bLat2 * K_LAT - cy);
        if (d < best) { best = d; bLat = bLat2; bLon = bLon2; }
      }
    }
    if (best < cornerR) return { lat: bLat, lon: bLon, type: "corner" };
  }

  // ── 3. Snap de position : arêtes parcelle ───────────────────────────────────
  if (config.edges && parcelRing) {
    let best = edgeR;
    let bLat = lat, bLon = lon;
    for (let i = 0; i < parcelRing.length - 1; i++) {
      const [x1, y1] = [parcelRing[i][0] * kl, parcelRing[i][1] * K_LAT];
      const [x2, y2] = [parcelRing[i + 1][0] * kl, parcelRing[i + 1][1] * K_LAT];
      const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
      if (len2 < 1e-10) continue;
      const t = Math.max(0, Math.min(1, ((cx - x1) * dx + (cy - y1) * dy) / len2));
      const fx = x1 + t * dx, fy = y1 + t * dy;
      const d = Math.hypot(cx - fx, cy - fy);
      if (d < best) { best = d; bLat = fy / K_LAT; bLon = fx / kl; }
    }
    if (best < edgeR) return { lat: bLat, lon: bLon, type: "edge" };
  }

  // ── 4. Snap angulaire (grille 5° + perpendiculaires) ────────────────────────
  if (vertices.length > 0) {
    const last = vertices[vertices.length - 1];
    const dx = (lon - last[1]) * kl;
    const dy = (lat - last[0]) * K_LAT;
    const dist = Math.hypot(dx, dy);

    if (dist > 0.1) {
      const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);

      // ── Perpendiculaire au segment précédent (priorité haute) ───────────────
      if (config.perpSeg && vertices.length >= 2) {
        const prev = vertices[vertices.length - 2];
        const segDx = (last[1] - prev[1]) * kl;
        const segDy = (last[0] - prev[0]) * K_LAT;
        const segAngle = Math.atan2(segDy, segDx) * (180 / Math.PI);
        for (const candidate of [segAngle + 90, segAngle - 90]) {
          const diff = Math.abs(((angleDeg - candidate + 540) % 360) - 180);
          if (diff < 3) {
            const rad = candidate * (Math.PI / 180);
            return {
              lat: last[0] + (dist * Math.sin(rad)) / K_LAT,
              lon: last[1] + (dist * Math.cos(rad)) / kl,
              type: "perp-seg",
              angleDeg: candidate,
              color: "#10b981",
            };
          }
        }
      }

      // Grille 5°
      const snapped5 = Math.round(angleDeg / 5) * 5;
      if (config.angles && Math.abs(angleDeg - snapped5) < 2.5) {
        const rad = snapped5 * (Math.PI / 180);
        return {
          lat: last[0] + (dist * Math.sin(rad)) / K_LAT,
          lon: last[1] + (dist * Math.cos(rad)) / kl,
          type: "angle",
          angleDeg: snapped5,
          color: "#6366f1",
        };
      }

      // Direction arête parcelle la plus proche
      if (config.perpLimit && parcelRing) {
        const [eux, euy] = nearestEdgeDir(last[1], last[0], parcelRing);
        const edgeAngle = Math.atan2(euy * K_LAT, eux * kl) * (180 / Math.PI);
        for (const candidate of [edgeAngle, edgeAngle + 90, edgeAngle - 90, edgeAngle + 180]) {
          if (Math.abs(((angleDeg - candidate + 540) % 360) - 180) < 3) {
            const rad = candidate * (Math.PI / 180);
            return {
              lat: last[0] + (dist * Math.sin(rad)) / K_LAT,
              lon: last[1] + (dist * Math.cos(rad)) / kl,
              type: "perp",
              angleDeg: candidate,
              color: "#2563eb",
            };
          }
        }
      }
    }

    // Direction vers fermeture (si ≥ 3 sommets)
    if (vertices.length >= 3) {
      const first = vertices[0];
      const dxC = (lon - first[1]) * kl;
      const dyC = (lat - first[0]) * K_LAT;
      if (Math.hypot(dxC, dyC) < cornerR * 2) {
        return { lat: first[0], lon: first[1], type: "close", color: "#16a34a" };
      }
    }
  }

  return { lat, lon, type: "free" };
}

// ── Cotations ──────────────────────────────────────────────────────────────────

export interface CoteLine {
  from: [number, number]; // [lat, lon] point sur l'arête de la shape
  to:   [number, number]; // [lat, lon] point sur la limite de parcelle
  mid:  [number, number]; // [lat, lon] milieu pour le label
  dist: number;           // mètres
}

// Cotation perpendiculaire la plus défavorable par face de la shape.
//
// Pour chaque arête de la shape :
//   - on calcule la normale sortante (direction "vers l'extérieur")
//   - pour chaque arête de parcelle dont le centre est côté extérieur,
//     on cherche le pied de perpendiculaire (intérieur au segment) depuis
//     chacun des trois points candidats : x1 (bout A), milieu, x2 (bout B)
//   - on retient la distance minimale → valeur la plus défavorable
//   - le trait de cote part du point le plus proche, ⊥ à l'arête de parcelle
//     → jamais de coin de parcelle comme point d'arrivée
//
// poly       : [lat, lon][]
// parcelRing : [lon, lat][]  (GeoJSON)
// obstacles  : [lat, lon][][] (bâtiments existants)
export function buildCoteLines(
  poly: [number, number][],
  parcelRing: [number, number][],
  obstacles?: [number, number][][],
): CoteLine[] {
  const n = poly.length;
  if (n < 2) return [];

  const avgLat = poly.reduce((s, [lat]) => s + lat, 0) / n;
  const kl = kLon(avgLat);

  const polyM   = poly.map(([lat, lon]) => [lon * kl, lat * K_LAT] as [number, number]);
  const parcelM = parcelRing.map(([lon, lat]) => [lon * kl, lat * K_LAT] as [number, number]);
  const obstM   = (obstacles ?? []).map((ring) =>
    ring.map(([lat, lon]) => [lon * kl, lat * K_LAT] as [number, number]),
  );
  const allRingsM = [parcelM, ...obstM];

  const ctrx = polyM.reduce((s, [x]) => s + x, 0) / n;
  const ctry = polyM.reduce((s, [, y]) => s + y, 0) / n;

  const lines: CoteLine[] = [];

  for (let i = 0; i < n; i++) {
    const [x1, y1] = polyM[i];
    const [x2, y2] = polyM[(i + 1) % n];
    const fdx = x2 - x1, fdy = y2 - y1;
    const flen = Math.sqrt(fdx * fdx + fdy * fdy);
    if (flen < 0.01) continue;

    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;

    // Normale sortante (pointe vers l'extérieur du polygone)
    let nx = -fdy / flen, ny = fdx / flen;
    if (nx * (ctrx - mx) + ny * (ctry - my) > 0) { nx = -nx; ny = -ny; }

    // Trois points candidats sur l'arête : bout A, milieu, bout B
    const candidates: [number, number][] = [[x1, y1], [mx, my], [x2, y2]];

    let bestDist = Infinity;
    let bestFromX = mx, bestFromY = my, bestFx = 0, bestFy = 0;

    for (const ring of allRingsM) {
      for (let j = 0; j < ring.length - 1; j++) {
        const [cx, cy] = ring[j], [dx, dy] = ring[j + 1];
        const edgeDx = dx - cx, edgeDy = dy - cy;
        const edgeLen2 = edgeDx * edgeDx + edgeDy * edgeDy;
        if (edgeLen2 < 1e-10) continue;

        // Vérifier que cette arête de parcelle est du côté extérieur de la face
        // (produit scalaire entre le vecteur milieu→milieu-limite et la normale sortante)
        const emx = (cx + dx) / 2, emy = (cy + dy) / 2;
        if ((emx - mx) * nx + (emy - my) * ny <= 0) continue;

        for (const [px, py] of candidates) {
          // Pied de perpendiculaire de (px,py) sur le segment de parcelle
          const tProj = ((px - cx) * edgeDx + (py - cy) * edgeDy) / edgeLen2;
          if (tProj < 0 || tProj > 1) continue; // pied hors du segment → skip (pas de coin de parcelle)

          const fx = cx + tProj * edgeDx, fy = cy + tProj * edgeDy;
          const dist = Math.sqrt((px - fx) ** 2 + (py - fy) ** 2);
          if (dist < 0.05 || dist >= bestDist) continue;

          bestDist = dist;
          bestFromX = px; bestFromY = py;
          bestFx = fx;   bestFy = fy;
        }
      }
    }

    if (!isFinite(bestDist)) continue;

    lines.push({
      from: [bestFromY / K_LAT, bestFromX / kl],
      to:   [bestFy / K_LAT,    bestFx / kl],
      mid:  [(bestFromY / K_LAT + bestFy / K_LAT) / 2,
             (bestFromX / kl    + bestFx / kl)    / 2],
      dist: bestDist,
    });
  }

  return lines;
}

// ── Distance forme → limite de parcelle ────────────────────────────────────────

/**
 * Distance minimale en mètres entre un polygone de surface et l'anneau de parcelle.
 * Teste tous les sommets + milieux des arêtes de la surface sur toutes les arêtes de parcelle.
 * Ne pose pas de contrainte de direction (différent de buildCoteLines) → résultat toujours fini.
 *
 * shapePoly  : [lat, lon][]
 * parcelRing : [lon, lat][]
 */
export function minDistToParcel(
  shapePoly: [number, number][],
  parcelRing: [number, number][],
): number {
  const n = shapePoly.length;
  if (n < 1) return Infinity;

  const avgLat = shapePoly.reduce((s, [lat]) => s + lat, 0) / n;
  const kl = kLon(avgLat);

  const shapeM  = shapePoly.map(([lat, lon]) => [lon * kl, lat * K_LAT] as [number, number]);
  const parcelM = parcelRing.map(([lon, lat]) => [lon * kl, lat * K_LAT] as [number, number]);
  const nP = parcelM.length - 1;

  // Candidats : sommets + milieu de chaque arête de la surface
  const candidates: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    candidates.push(shapeM[i]);
    const [nx, ny] = shapeM[(i + 1) % n];
    candidates.push([(shapeM[i][0] + nx) / 2, (shapeM[i][1] + ny) / 2]);
  }

  let minDist = Infinity;
  for (const [px, py] of candidates) {
    for (let j = 0; j < nP; j++) {
      const [cx, cy] = parcelM[j];
      const [dx, dy] = parcelM[j + 1];
      const edx = dx - cx, edy = dy - cy;
      const len2 = edx * edx + edy * edy;
      if (len2 < 1e-10) continue;
      const t = Math.max(0, Math.min(1, ((px - cx) * edx + (py - cy) * edy) / len2));
      const dist = Math.sqrt((px - cx - t * edx) ** 2 + (py - cy - t * edy) ** 2);
      if (dist < minDist) minDist = dist;
    }
  }
  return minDist;
}

/**
 * Distance minimale de shapePoly aux arêtes "fond" de la parcelle.
 * Une arête est fond si son milieu (par rapport au centroïde) forme un dot < −0.5
 * avec le vecteur centroïde → accessPoint.
 */
export function minDistToFondEdges(
  shapePoly: [number, number][],
  parcelRing: [number, number][],
  access: { lat: number; lon: number },
): number {
  const DOT_FOND = 0.5;
  const n = shapePoly.length;
  if (n < 1) return Infinity;

  const avgLat = shapePoly.reduce((s, [lat]) => s + lat, 0) / n;
  const kl = kLon(avgLat);

  const shapeM  = shapePoly.map(([lat, lon]) => [lon * kl, lat * K_LAT] as [number, number]);
  const parcelM = parcelRing.map(([lon, lat]) => [lon * kl, lat * K_LAT] as [number, number]);
  const nP = parcelM.length - 1;

  const cx0 = parcelM.slice(0, nP).reduce((s, [x]) => s + x, 0) / nP;
  const cy0 = parcelM.slice(0, nP).reduce((s, [, y]) => s + y, 0) / nP;

  const ax = access.lon * kl - cx0, ay = access.lat * K_LAT - cy0;
  const aLen = Math.sqrt(ax * ax + ay * ay);
  if (aLen < 1e-6) return Infinity;
  const anx = ax / aLen, any = ay / aLen;

  const fondEdges: number[] = [];
  for (let j = 0; j < nP; j++) {
    const mx = (parcelM[j][0] + parcelM[j + 1][0]) / 2 - cx0;
    const my = (parcelM[j][1] + parcelM[j + 1][1]) / 2 - cy0;
    const mLen = Math.sqrt(mx * mx + my * my);
    if (mLen < 1e-6) continue;
    if ((mx * anx + my * any) / mLen < -DOT_FOND) fondEdges.push(j);
  }
  if (fondEdges.length === 0) return Infinity;

  const candidates: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    candidates.push(shapeM[i]);
    candidates.push([(shapeM[i][0] + shapeM[(i + 1) % n][0]) / 2, (shapeM[i][1] + shapeM[(i + 1) % n][1]) / 2]);
  }

  let minDist = Infinity;
  for (const [px, py] of candidates) {
    for (const j of fondEdges) {
      const [ex, ey] = parcelM[j], [fx, fy] = parcelM[j + 1];
      const edx = fx - ex, edy = fy - ey;
      const len2 = edx * edx + edy * edy;
      if (len2 < 1e-10) continue;
      const t = Math.max(0, Math.min(1, ((px - ex) * edx + (py - ey) * edy) / len2));
      const dist = Math.sqrt((px - ex - t * edx) ** 2 + (py - ey - t * edy) ** 2);
      if (dist < minDist) minDist = dist;
    }
  }
  return minDist;
}

/**
 * Distance minimale de shapePoly aux arêtes "voirie" de la parcelle.
 * Utilise le même critère que classifyEdgeSetbacks (MapOL) :
 * voirie = arête(s) dont la distance au point d'accès ≤ minDist + 20 % + 0.8 m.
 * → cohérence garantie entre la zone constructible affichée et le check de conformité.
 */
export function minDistToVoirieEdges(
  shapePoly: [number, number][],
  parcelRing: [number, number][],
  access: { lat: number; lon: number },
): number {
  const n = shapePoly.length;
  if (n < 1) return Infinity;

  // ── 1. Identifier les arêtes voirie (même algo que classifyEdgeSetbacks) ──
  const kp = kLon(access.lat);
  const ax = access.lon * kp, ay = access.lat * K_LAT;
  const nP = parcelRing.length - 1;
  const ringM = parcelRing.map(([lon, lat]) => [lon * kp, lat * K_LAT] as [number, number]);

  const edgeDists = Array.from({ length: nP }, (_, j) => {
    const [x1, y1] = ringM[j], [x2, y2] = ringM[j + 1];
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
    if (len2 < 1e-10) return Infinity;
    const t = Math.max(0, Math.min(1, ((ax - x1) * dx + (ay - y1) * dy) / len2));
    return Math.sqrt((ax - x1 - t * dx) ** 2 + (ay - y1 - t * dy) ** 2);
  });

  const minEdgeDist = Math.min(...edgeDists);
  const vTol = minEdgeDist * 0.20 + 0.8;
  const voirieEdges = edgeDists
    .map((d, j) => (d <= minEdgeDist + vTol ? j : -1))
    .filter(j => j >= 0);

  if (voirieEdges.length === 0) return Infinity;

  // ── 2. Distance minimale shape → arêtes voirie ────────────────────────────
  const avgLat = shapePoly.reduce((s, [lat]) => s + lat, 0) / n;
  const kl = kLon(avgLat);
  const shapeM  = shapePoly.map(([lat, lon]) => [lon * kl, lat * K_LAT] as [number, number]);
  const parcelM = parcelRing.map(([lon, lat]) => [lon * kl, lat * K_LAT] as [number, number]);

  const candidates: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    candidates.push(shapeM[i]);
    candidates.push([(shapeM[i][0] + shapeM[(i + 1) % n][0]) / 2, (shapeM[i][1] + shapeM[(i + 1) % n][1]) / 2]);
  }

  let minDist = Infinity;
  for (const [px, py] of candidates) {
    for (const j of voirieEdges) {
      const [ex, ey] = parcelM[j], [fx, fy] = parcelM[j + 1];
      const edx = fx - ex, edy = fy - ey;
      const len2 = edx * edx + edy * edy;
      if (len2 < 1e-10) continue;
      const t = Math.max(0, Math.min(1, ((px - ex) * edx + (py - ey) * edy) / len2));
      const dist = Math.sqrt((px - ex - t * edx) ** 2 + (py - ey - t * edy) ** 2);
      if (dist < minDist) minDist = dist;
    }
  }
  return minDist;
}

// ── Classification des arêtes (voirie / latéral / fond) ──────────────────────

/**
 * Pour chaque arête de la parcelle, retourne le recul applicable :
 *   rv = voirie, rl = latéral, rf = fond.
 * Voirie  = arête(s) dont la distance au point d'accès ≤ minDist × 1,20 + 0,8 m.
 * Fond    = arête opposée à l'accès (dot le plus négatif, < −0,30).
 * ring    : [lon, lat][] GeoJSON
 */
export function classifyEdgeSetbacks(
  ring: [number, number][],
  access: { lat: number; lon: number } | null,
  rv: number, rl: number, rf: number,
): number[] {
  const n = ring.length - 1;
  if (!access) return Array(n).fill(rl);

  const avgLat = ring.slice(0, n).reduce((s, [, lat]) => s + lat, 0) / n;
  const kl = kLon(avgLat);

  const ax = access.lon * kl, ay = access.lat * K_LAT;
  const cx = ring.slice(0, n).reduce((s, [lon]) => s + lon * kl, 0) / n;
  const cy = ring.slice(0, n).reduce((s, [, lat]) => s + lat * K_LAT, 0) / n;

  const dacx = ax - cx, dacy = ay - cy;
  const dacLen = Math.sqrt(dacx * dacx + dacy * dacy);
  if (dacLen < 0.01) return Array(n).fill(rl);
  const anx = dacx / dacLen, any = dacy / dacLen;

  const edges = Array.from({ length: n }, (_, i) => {
    const [lon1, lat1] = ring[i], [lon2, lat2] = ring[(i + 1) % n];
    const x1 = lon1 * kl, y1 = lat1 * K_LAT;
    const x2 = lon2 * kl, y2 = lat2 * K_LAT;
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.01) return { dist: Infinity, dot: 0 };

    let nx = -dy / len, ny = dx / len;
    const midx = (x1 + x2) / 2, midy = (y1 + y2) / 2;
    if (nx * (cx - midx) + ny * (cy - midy) > 0) { nx = -nx; ny = -ny; }
    const dot = nx * anx + ny * any;

    const len2 = len * len;
    const t = Math.max(0, Math.min(1, ((ax - x1) * dx + (ay - y1) * dy) / len2));
    const px = x1 + t * dx, py = y1 + t * dy;
    const dist = Math.sqrt((ax - px) ** 2 + (ay - py) ** 2);
    return { dist, dot };
  });

  const minDist = Math.min(...edges.map(e => e.dist));
  const vTol    = minDist * 0.20 + 0.8;
  const minDot  = Math.min(...edges.map(e => e.dot));

  return edges.map(({ dist, dot }) => {
    if (dist <= minDist + vTol)             return rv;  // voirie
    if (dot <= minDot + 0.15 && dot < -0.30) return rf;  // fond
    return rl;                                            // latéral
  });
}

// ── Zone constructible ─────────────────────────────────────────────────────────

function seg2dIntersect(
  p1: [number, number], p2: [number, number],
  p3: [number, number], p4: [number, number],
): [number, number] | null {
  const dx1 = p2[0] - p1[0], dy1 = p2[1] - p1[1];
  const dx2 = p4[0] - p3[0], dy2 = p4[1] - p3[1];
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((p3[0] - p1[0]) * dy2 - (p3[1] - p1[1]) * dx2) / denom;
  const s = ((p3[0] - p1[0]) * dy1 - (p3[1] - p1[1]) * dx1) / denom;
  if (t <= 0 || t >= 1 || s <= 0 || s >= 1) return null;
  return [p1[0] + t * dx1, p1[1] + t * dy1];
}

function removeKnots(pts: [number, number][]): [number, number][] {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = pts[j], d = pts[(j + 1) % n];
      const ix = seg2dIntersect(a, b, c, d);
      if (ix) {
        const next = [...pts.slice(0, i + 1), ix, ...pts.slice(j + 1)];
        if (next.length < 3) return pts;
        return removeKnots(next);
      }
    }
  }
  return pts;
}

/**
 * Inward polygon offset par intersection de droites + suppression des auto-intersections.
 * ring     : [lon, lat][] (GeoJSON, anneau fermé)
 * setbacks : retrait en mètres par arête (longueur = ring.length - 1)
 * Retourne : [lat, lon][] ou null
 */
export function computeOffsetPoly(
  ring: [number, number][],
  setbacks: number[],
): [number, number][] | null {
  const n = ring.length - 1;
  if (n < 3 || setbacks.length !== n) return null;
  const avgLat = ring.reduce((s, [, lat]) => s + lat, 0) / n;
  const kl = kLon(avgLat);

  const pts: [number, number][] = Array.from({ length: n }, (_, i) => [ring[i][0] * kl, ring[i][1] * K_LAT]);

  let area = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n];
    area += x1 * y2 - x2 * y1;
  }
  const ccw = area > 0;

  const normals: [number, number][] = Array.from({ length: n }, (_, i) => {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n];
    const dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.01) return [0, 0];
    return ccw ? [-dy / len, dx / len] : [dy / len, -dx / len];
  });

  const raw: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const j = (i - 1 + n) % n;
    const [nx1, ny1] = normals[j];
    const [nx2, ny2] = normals[i];
    const sb1 = setbacks[j], sb2 = setbacks[i];
    const ax = pts[i][0] + nx1 * sb1, ay = pts[i][1] + ny1 * sb1;
    const bx = pts[i][0] + nx2 * sb2, by = pts[i][1] + ny2 * sb2;
    const [dx1, dy1] = [pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]];
    const [dx2, dy2] = [pts[(i + 1) % n][0] - pts[i][0], pts[(i + 1) % n][1] - pts[i][1]];
    const denom = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(denom) < 1e-6) {
      raw.push([(ax + bx) / 2, (ay + by) / 2]);
    } else {
      const t = ((bx - ax) * dy2 - (by - ay) * dx2) / denom;
      raw.push([ax + t * dx1, ay + t * dy1]);
    }
  }

  const result = removeKnots(raw);
  if (result.length < 3) return null;
  return result.map(([x, y]) => [y / K_LAT, x / kl] as [number, number]);
}

// Wrapper rétrocompatible : offset uniforme
// ring : [lon, lat][] → retourne [lat, lon][]
export function computeZoneConstructible(
  ring: [number, number][],
  retraitM: number,
): [number, number][] | null {
  if (ring.length < 4 || retraitM <= 0) return null;
  return computeOffsetPoly(ring, Array(ring.length - 1).fill(retraitM));
}

// ── Suppression des couloirs étroits ─────────────────────────────────────────

/**
 * Morphological opening : érode puis dilate pour supprimer les appendices
 * plus étroits que minWidthM (ex : allée privée de 4 m).
 * poly : [lat, lon][] format app — retourne le même format.
 */
export function removeNarrowCorridors(
  poly: [number, number][],
  minWidthM = 4,
): [number, number][] {
  if (poly.length < 3) return poly;
  const erodeM = minWidthM / 2 + 0.1;
  try {
    const turfPoly = appPolyToTurf(poly);
    const eroded = turf.buffer(turfPoly, -erodeM, { units: "meters" });
    if (!eroded) return poly;
    let mainPoly: Feature<Polygon>;
    if (eroded.geometry.type === "MultiPolygon") {
      const coords = eroded.geometry.coordinates as number[][][][];
      const largest = coords.reduce((a, b) =>
        turf.area(turf.polygon(a)) >= turf.area(turf.polygon(b)) ? a : b,
      );
      mainPoly = turf.polygon(largest) as Feature<Polygon>;
    } else {
      mainPoly = eroded as Feature<Polygon>;
    }
    const dilated = turf.buffer(mainPoly, erodeM, { units: "meters" });
    if (!dilated) return poly;
    // Intersection avec le polygone original pour restaurer les coins nets
    const clipped = turf.intersect(
      turf.featureCollection([turfPoly, dilated as Feature<Polygon>]),
    );
    if (clipped && clipped.geometry.type === "Polygon") {
      const result = turfPolyToApp(clipped as Feature<Polygon>);
      return result.length >= 3 ? result : poly;
    }
    // Fallback : dilaté sans clip
    if (dilated.geometry.type === "Polygon") {
      const result = turfPolyToApp(dilated as Feature<Polygon>);
      return result.length >= 3 ? result : poly;
    }
    return poly;
  } catch {
    return poly;
  }
}

// ── Point dans polygone ───────────────────────────────────────────────────────

/** Test si (lon, lat) est dans un anneau GeoJSON [lon, lat][]. */
export function pointInRing(lon: number, lat: number, ring: [number, number][]): boolean {
  return turf.booleanPointInPolygon(turf.point([lon, lat]), geoRingToTurf(ring));
}

// ── Rotation d'un polygone ────────────────────────────────────────────────────

/** Rotation d'un polygone [lat,lon][] autour de son centroïde, angle en degrés. */
export function rotatePoly(poly: [number, number][], angleDeg: number): [number, number][] {
  if (poly.length < 2) return poly;
  return turfPolyToApp(turf.transformRotate(appPolyToTurf(poly), angleDeg, { mutate: false }) as Feature<Polygon>);
}

// ── Parking automatique ────────────────────────────────────────────────────────

/**
 * Construit le rectangle d'un stationnement non clos positionné sur la limite voirie.
 * ap        : point d'accès {lat, lon}
 * widthM    : largeur totale en mètres
 * depthM    : profondeur en mètres (vers l'intérieur)
 * parcelRing: [lon, lat][] GeoJSON
 * Retourne  : [lat, lon][] (4 coins)
 */
export function buildParkingPolygon(
  ap: { lat: number; lon: number },
  widthM: number,
  depthM: number,
  parcelRing: [number, number][],
): [number, number][] {
  const kl = kLon(ap.lat);
  const apX = ap.lon * kl, apY = ap.lat * K_LAT;
  const ringM = parcelRing.map(([lon, lat]) => [lon * kl, lat * K_LAT] as [number, number]);
  const nSeg = ringM.length - 1;

  // Centroïde
  const cx = ringM.reduce((s, [x]) => s + x, 0) / nSeg;
  const cy = ringM.reduce((s, [, y]) => s + y, 0) / nSeg;

  // Segment voirie le plus proche du point d'accès
  let bestDistSq = Infinity, bestJ = 0, bestT = 0;
  for (let j = 0; j < nSeg; j++) {
    const [x1, y1] = ringM[j], [x2, y2] = ringM[j + 1];
    const dx = x2 - x1, dy = y2 - y1, lenSq = dx * dx + dy * dy;
    if (lenSq < 1) continue;
    const t = Math.max(0, Math.min(1, ((apX - x1) * dx + (apY - y1) * dy) / lenSq));
    const d2 = (x1 + t * dx - apX) ** 2 + (y1 + t * dy - apY) ** 2;
    if (d2 < bestDistSq) { bestDistSq = d2; bestJ = j; bestT = t; }
  }

  // Direction du segment voirie
  const [x1r, y1r] = ringM[bestJ], [x2r, y2r] = ringM[bestJ + 1];
  const dxR = x2r - x1r, dyR = y2r - y1r, lenR = Math.sqrt(dxR * dxR + dyR * dyR);
  const segE = dxR / lenR, segN = dyR / lenR;

  // Normale inward
  const n1E = -segN, n1N = segE;
  const dotC = (cx - apX) * n1E + (cy - apY) * n1N;
  const inE = dotC >= 0 ? n1E : -n1E;
  const inN = dotC >= 0 ? n1N : -n1N;

  // Base = projection du point d'accès sur le segment voirie
  const baseX = x1r + bestT * dxR, baseY = y1r + bestT * dyR;

  // Coordonnées parking (latéral le long de la voirie, profondeur vers intérieur)
  const pc = ringM.map(([vx, vy]) => ({
    lat: (vx - baseX) * segE + (vy - baseY) * segN,
    dep: (vx - baseX) * inE  + (vy - baseY) * inN,
  }));

  // Profondeur limitée par les obstacles inward
  let depth = depthM;
  for (const { dep } of pc) {
    if (dep > 0.5 && dep < depth) depth = dep;
  }
  depth = Math.max(1, depth - 0.3);

  // Largeur limitée par les extrémités du segment et les arêtes latérales
  let rightDist = Math.min(widthM / 2, (1 - bestT) * lenR);
  let leftDist  = Math.min(widthM / 2, bestT * lenR);

  for (let j = 0; j < nSeg; j++) {
    if (j === bestJ) continue;
    const a = pc[j], b = pc[(j + 1) % nSeg];
    const ddep = b.dep - a.dep, dlat = b.lat - a.lat;
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
    if (latLo > 0) rightDist = Math.min(rightDist, latLo);
    if (latHi < 0) leftDist  = Math.min(leftDist, -latHi);
  }
  rightDist = Math.max(0, rightDist - 0.1);
  leftDist  = Math.max(0, leftDist  - 0.1);

  // Rectangle final
  const toLatLon = (x: number, y: number): [number, number] => [y / K_LAT, x / kl];
  return [
    toLatLon(baseX - segE * leftDist,                    baseY - segN * leftDist),
    toLatLon(baseX + segE * rightDist,                   baseY + segN * rightDist),
    toLatLon(baseX + segE * rightDist + inE * depth,     baseY + segN * rightDist + inN * depth),
    toLatLon(baseX - segE * leftDist  + inE * depth,     baseY - segN * leftDist  + inN * depth),
  ];
}

/** Largeur disponible le long de l'arête voirie (pour choisir la config parking). */
export function measureAccessWidth(
  ap: { lat: number; lon: number },
  parcelRing: [number, number][],
): number {
  const kl = kLon(ap.lat);
  const apX = ap.lon * kl, apY = ap.lat * K_LAT;
  const ringM = parcelRing.map(([lon, lat]) => [lon * kl, lat * K_LAT] as [number, number]);
  const nSeg = ringM.length - 1;
  let bestDistSq = Infinity, bestJ = 0, bestT = 0;
  for (let j = 0; j < nSeg; j++) {
    const [x1, y1] = ringM[j], [x2, y2] = ringM[j + 1];
    const dx = x2 - x1, dy = y2 - y1, lenSq = dx * dx + dy * dy;
    if (lenSq < 1) continue;
    const t = Math.max(0, Math.min(1, ((apX - x1) * dx + (apY - y1) * dy) / lenSq));
    const d2 = (x1 + t * dx - apX) ** 2 + (y1 + t * dy - apY) ** 2;
    if (d2 < bestDistSq) { bestDistSq = d2; bestJ = j; bestT = t; }
  }
  const [x1r, y1r] = ringM[bestJ], [x2r, y2r] = ringM[bestJ + 1];
  return Math.sqrt((x2r - x1r) ** 2 + (y2r - y1r) ** 2);
}

// ── Types PLU ──────────────────────────────────────────────────────────────────

export interface PluRules {
  empriseMaxPct:        number;  // % emprise au sol max (ex: 40)
  retraitVoirie:        number;  // mètres — bâtiment principal
  retraitLateral:       number;  // mètres
  retraitFond:          number;  // mètres — fond de parcelle
  hauteurMax:           number;  // mètres
  espacesVertsPct:      number;  // % min espaces verts
  // Règles spécifiques annexes / dépendances
  retraitVoirieAnnexe:  number;  // mètres (0 = pas de règle spécifique → utilise retraitVoirie)
  surfaceMaxAnnexe:     number;  // m² (0 = non précisé)
  longueurMaxAnnexe:    number;  // mètres (0 = non précisé)
  hauteurMaxAnnexe:     number;  // mètres (0 = non précisé)
  // Règles d'aspect (qualitatives — texte libre extrait du PLU/CPAP)
  aspectToiture:        string;  // type de toiture (ex: "4 pentes, tuiles canal obligatoires")
  aspectTuiles:         string;  // couverture (ex: "tuiles rondes canal, ton naturel")
  aspectMenuiseries:    string;  // menuiseries (ex: "couleurs naturelles, blanc interdit")
  aspectClotures:       string;  // clôtures (ex: "mur enduit max 1.6 m côté voirie")
  aspectVegetaux:       string;  // végétaux (ex: "1 arbre tige pour 50 m² de terrain")
  aspectPiscine:        string;  // piscine / bassin (ex: "autorisée, recul 1 m des limites")
  aspectTerrasses:      string;  // terrasses (ex: "surélevées ≤ 0.6 m du sol fini")
}

export interface ConformiteResult {
  empriseSol:      { valeur: number; max: number; conforme: boolean };
  surfacePlancher: { valeur: number };
  hauteurMax:      { valeur: number; max: number; conforme: boolean };              // bâtiment principal
  hauteurAnnexe:   { valeur: number; max: number; conforme: boolean; applique: boolean }; // annexe/garage
  surfaceAnnexe:   { valeur: number; max: number; conforme: boolean; applique: boolean }; // surface max annexe
  longueurAnnexe:  { valeur: number; max: number; conforme: boolean; applique: boolean }; // longueur max annexe
  gabarit:         { conforme: boolean; ratioMin: number; applique: boolean };
  retraitMin:      { valeur: number; requis: number; conforme: boolean; applique: boolean; enLimite: boolean };
  retraitFond:     { valeur: number; requis: number; conforme: boolean; applique: boolean };
  espacesVerts:    { valeur: number; min: number; conforme: boolean };
  global:          boolean;
}

/**
 * Vérifie la conformité PLU à partir de valeurs pré-calculées.
 * Les calculs par type (empriseSol, surfacePlancher, etc.) sont faits dans PlanEditor
 * en utilisant SHAPE_TYPE_CONFIG, pour garder geo.ts indépendant des types métier.
 */
export function checkConformite(
  parcelSurface: number,
  empriseSol: number,
  surfacePlancher: number,
  hauteurMax: number,          // hauteur max bâtiment principal (rdc/r1/r2/autre)
  hauteurAnnexeVal: number,    // hauteur max annexe/garage
  surfaceAnnexeVal: number,    // surface de la plus grande annexe/garage (m²)
  longueurAnnexeVal: number,   // plus grande dimension d'une annexe/garage (m)
  minSetback: number,
  minGabaritRatio: number,
  rules: PluRules,
  minSetbackFond = Infinity,
): ConformiteResult {
  const empriseVal = parcelSurface > 0 ? (empriseSol / parcelSurface) * 100 : 0;
  const espVerts   = parcelSurface > 0 ? ((parcelSurface - empriseSol) / parcelSurface) * 100 : 100;

  const retApplique  = isFinite(minSetback);
  const gabApplique  = isFinite(minGabaritRatio);
  const fondApplique = isFinite(minSetbackFond) && rules.retraitFond !== rules.retraitLateral;

  const EN_LIMITE_SEUIL = 0.20;
  const enLimite = retApplique && minSetback < EN_LIMITE_SEUIL;

  const emp  = { valeur: empriseVal, max: rules.empriseMaxPct, conforme: empriseVal <= rules.empriseMaxPct };
  const hMax = { valeur: hauteurMax, max: rules.hauteurMax,    conforme: hauteurMax <= rules.hauteurMax || hauteurMax === 0 };
  const gab  = { conforme: !gabApplique || minGabaritRatio >= 0.5, ratioMin: minGabaritRatio, applique: gabApplique };
  const ret  = { valeur: minSetback, requis: rules.retraitLateral,
                 conforme: !retApplique || enLimite || minSetback >= rules.retraitLateral,
                 applique: retApplique, enLimite };
  const fond = { valeur: minSetbackFond, requis: rules.retraitFond,
                 conforme: !fondApplique || minSetbackFond >= rules.retraitFond,
                 applique: fondApplique };
  const esp  = { valeur: espVerts, min: rules.espacesVertsPct, conforme: espVerts >= rules.espacesVertsPct };

  // Annexe / garage : vérifications spécifiques (seulement si la règle PLU est renseignée)
  const hAnnexeApplique = hauteurAnnexeVal > 0 && rules.hauteurMaxAnnexe > 0;
  const sAnnexeApplique = surfaceAnnexeVal > 0 && rules.surfaceMaxAnnexe > 0;
  const lAnnexeApplique = longueurAnnexeVal > 0 && rules.longueurMaxAnnexe > 0;
  const hAnnexe = { valeur: hauteurAnnexeVal, max: rules.hauteurMaxAnnexe,
                    conforme: !hAnnexeApplique || hauteurAnnexeVal <= rules.hauteurMaxAnnexe,
                    applique: hAnnexeApplique };
  const sAnnexe = { valeur: surfaceAnnexeVal, max: rules.surfaceMaxAnnexe,
                    conforme: !sAnnexeApplique || surfaceAnnexeVal <= rules.surfaceMaxAnnexe,
                    applique: sAnnexeApplique };
  const lAnnexe = { valeur: longueurAnnexeVal, max: rules.longueurMaxAnnexe,
                    conforme: !lAnnexeApplique || longueurAnnexeVal <= rules.longueurMaxAnnexe,
                    applique: lAnnexeApplique };

  return {
    empriseSol: emp,
    surfacePlancher: { valeur: surfacePlancher },
    hauteurMax: hMax,
    hauteurAnnexe: hAnnexe,
    surfaceAnnexe: sAnnexe,
    longueurAnnexe: lAnnexe,
    gabarit: gab,
    retraitMin: ret,
    retraitFond: fond,
    espacesVerts: esp,
    global: emp.conforme && hMax.conforme && hAnnexe.conforme && sAnnexe.conforme && lAnnexe.conforme && ret.conforme && fond.conforme && esp.conforme,
  };
}

