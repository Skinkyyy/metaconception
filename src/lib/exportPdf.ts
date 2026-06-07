import { PDFDocument, rgb, degrees, StandardFonts } from "pdf-lib";
import type { Color, PDFFont, PDFPage } from "pdf-lib";
import type { ConformiteResult, PluRules } from "./geo";
import { K_LAT, kLon, classifyEdgeSetbacks, computeOffsetPoly } from "./geo";
import type { DrawnShape } from "../components/PlanEditor";
import { SHAPE_TYPE_CONFIG } from "../components/shapeConstants";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PdfExportData {
  address: string;
  parcelId: string;
  parcelSurface: number;
  parcelRing: [number, number][];   // [lon, lat][] GeoJSON
  shapes: DrawnShape[];
  conformite: ConformiteResult;
  pluRules: PluRules;
  empriseSol: number;
  surfacePlancher: number;
  minSetbackVoirie: number;
  minSetbackVoirieAnnexe: number;
  accessPoint?: { lat: number; lon: number } | null;
  mapCapture?: { dataUrl: string; extent: [number, number, number, number] } | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m
    ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255]
    : [0.5, 0.5, 0.5];
}

// Mélange hex couleur avec du blanc (factor=0 → blanc, factor=1 → couleur)
function mixWithWhite(hex: string, factor = 0.5): Color {
  const [r, g, b] = hexToRgb(hex);
  return rgb(r * factor + (1 - factor), g * factor + (1 - factor), b * factor + (1 - factor));
}

// Supprime les caractères hors WinAnsi (emoji, CJK, …) — pdf-lib polices standard
function sanitize(text: string): string {
  return text
    .replace(/\uD83C[\uDD70-\uDDFF]/gu, "P")  // cercles de lettres (🅿, etc.) → lettre
    .replace(/[^\x20-\x7E\xA0-\xFF]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Enveloppe texte simple — retourne les lignes
function wrapText(text: string, font: { widthOfTextAtSize: (t: string, s: number) => number }, maxWidth: number, size: number): string[] {
  const words = sanitize(text).split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Rend le SVG via un canvas pour obtenir des bytes PNG embarquables dans pdf-lib
async function rasterizeSvgLogo(targetW: number, targetH: number): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width  = targetW * 2;  // 2× pour la qualité
        canvas.height = targetH * 2;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/png");
        const base64  = dataUrl.split(",")[1];
        resolve(Uint8Array.from(atob(base64), c => c.charCodeAt(0)));
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = "/logo-2026.svg";
  });
}

// ── Coordonnées ────────────────────────────────────────────────────────────────

/**
 * Convertit lat/lon vers PDF (x, y) en centrant et scalant le plan.
 * mapCenter   : { pdfX, pdfY } — centre de la zone de dessin en coords PDF
 * scale       : mètres → points PDF
 * centLat/Lon : centroïde de la parcelle
 */
function makeLlToPdf(
  centLon: number, centLat: number,
  mapCX: number, mapCY: number,
  scale: number,
) {
  const kl = kLon(centLat);
  return (lon: number, lat: number): [number, number] => {
    const mx = (lon - centLon) * kl;
    const my = (lat - centLat) * K_LAT;
    return [mapCX + mx * scale, mapCY + my * scale];
  };
}

// Crée le chemin SVG pour drawSvgPath (système: pdf-lib applique [1,0,0,-1,x,y])
// → SVG (svgX, svgY) → PDF (x+svgX, y-svgY)
// Si on passe x=0, y=H : SVG (px, H-py) → PDF (px, py)
function pdfPolyToSvg(pts: [number, number][], H: number): string {
  return pts.map(([px, py], i) =>
    `${i === 0 ? "M" : "L"} ${px.toFixed(2)} ${(H - py).toFixed(2)}`
  ).join(" ") + " Z";
}

// ── Dessin de conformité ───────────────────────────────────────────────────────

interface Page2Context {
  page: ReturnType<PDFDocument["addPage"]>;
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>;
  fontBold: Awaited<ReturnType<PDFDocument["embedFont"]>>;
  W: number;
  H: number;
  cy: number; // courant Y depuis le haut (diminue)
  COL_L: number;
  COL_W: number;
}

function p2text(ctx: Page2Context, text: string, x: number, yFromTop: number, size: number, bold = false, color: Color = rgb(0.93, 0.95, 0.91)) {
  ctx.page.drawText(sanitize(text), {
    x,
    y: ctx.H - yFromTop - size,
    size,
    font: bold ? ctx.fontBold : ctx.font,
    color,
  });
}

function drawRule(ctx: Page2Context, label: string, ok: boolean | null, valueStr: string) {
  const DOT_COLOR = ok === null ? rgb(0.5, 0.6, 0.5) : ok ? rgb(0.25, 0.78, 0.35) : rgb(0.9, 0.2, 0.2);
  const VAL_COLOR = ok === null ? rgb(0.7, 0.78, 0.7) : ok ? rgb(0.25, 0.78, 0.35) : rgb(0.9, 0.2, 0.2);
  ctx.page.drawCircle({ x: ctx.COL_L + 5, y: ctx.H - ctx.cy - 4, size: 3.5, color: DOT_COLOR });
  p2text(ctx, label, ctx.COL_L + 14, ctx.cy, 8, false);
  const vw = ctx.font.widthOfTextAtSize(valueStr, 8);
  p2text(ctx, valueStr, ctx.COL_L + ctx.COL_W - vw, ctx.cy, 8, true, VAL_COLOR);
  ctx.cy += 13;
}

function drawSectionTitle(ctx: Page2Context, title: string) {
  p2text(ctx, title, ctx.COL_L, ctx.cy, 7.5, true, rgb(0.5, 0.65, 0.53));
  ctx.cy += 12;
}

function drawHRule(ctx: Page2Context, strong = false) {
  ctx.page.drawLine({
    start: { x: ctx.COL_L, y: ctx.H - ctx.cy },
    end:   { x: ctx.COL_L + ctx.COL_W, y: ctx.H - ctx.cy },
    thickness: strong ? 0.5 : 0.3,
    color: strong ? rgb(0.4, 0.55, 0.43) : rgb(0.18, 0.28, 0.20),
  });
  ctx.cy += strong ? 8 : 6;
}

// ── Cotes dimensionnelles ─────────────────────────────────────────────────────

function fmtM(d: number): string {
  if (d >= 10) return `${d.toFixed(1)} m`;
  if (d >= 1)  return `${d.toFixed(2)} m`;
  return `${Math.round(d * 100)} cm`;
}

/**
 * Dessine les cotes (lignes d'extension + ligne de cote + tick + texte) pour
 * chaque arête d'un polygone PDF.
 *
 * @param pdfPts   Tableau de points PDF, NON répété ([n] pas égal [0])
 * @param scale    Points PDF par mètre (pour convertir dist PDF → mètres)
 * @param color    Couleur des cotes
 */
type Seg2 = [[number, number], [number, number]];

function drawDims(
  page: PDFPage,
  font: PDFFont,
  pdfPts: [number, number][],
  scale: number,
  color: Color,
  hasMapBg: boolean,
  drawn: Seg2[] = [],
): void {
  const OFFSET = 11;
  const EXT    = 3;
  const SIZE   = 5;

  const n = pdfPts.length;
  const pcx = pdfPts.reduce((s, [x]) => s + x, 0) / n;
  const pcy = pdfPts.reduce((s, [, y]) => s + y, 0) / n;

  for (let i = 0; i < n; i++) {
    const [ax, ay] = pdfPts[i];
    const [bx, by] = pdfPts[(i + 1) % n];

    const edgeDX = bx - ax, edgeDY = by - ay;
    const edgeLen = Math.sqrt(edgeDX * edgeDX + edgeDY * edgeDY);
    if (edgeLen < 12) continue;

    const ex = edgeDX / edgeLen, ey = edgeDY / edgeLen;
    let nx = -ey, ny = ex;
    const midX = (ax + bx) / 2, midY = (ay + by) / 2;
    if (nx * (pcx - midX) + ny * (pcy - midY) > 0) { nx = -nx; ny = -ny; }

    const ax2 = ax + nx * OFFSET, ay2 = ay + ny * OFFSET;
    const bx2 = bx + nx * OFFSET, by2 = by + ny * OFFSET;

    // ── Tests préalables (avant tout dessin) ──────────────────────────────
    const distM = edgeLen / scale;
    const txt = fmtM(distM);
    const tw = font.widthOfTextAtSize(txt, SIZE);
    if (tw + 8 > edgeLen) continue;  // texte ne rentre pas

    const coteSeg: Seg2 = [[ax2, ay2], [bx2, by2]];
    if (drawn.some(([p1, p2]) => seg2dCross(p1, p2, coteSeg[0], coteSeg[1]))) continue;

    // ── Dessin ────────────────────────────────────────────────────────────
    page.drawLine({ start: { x: ax + nx * 2, y: ay + ny * 2 }, end: { x: ax2 + nx * EXT, y: ay2 + ny * EXT }, thickness: 0.3, color });
    page.drawLine({ start: { x: bx + nx * 2, y: by + ny * 2 }, end: { x: bx2 + nx * EXT, y: by2 + ny * EXT }, thickness: 0.3, color });
    page.drawLine({ start: { x: ax2, y: ay2 }, end: { x: bx2, y: by2 }, thickness: 0.4, color });

    const T = 2.2;
    page.drawLine({ start: { x: ax2 + nx * T - ex * T, y: ay2 + ny * T - ey * T }, end: { x: ax2 - nx * T + ex * T, y: ay2 - ny * T + ey * T }, thickness: 0.6, color });
    page.drawLine({ start: { x: bx2 + nx * T - ex * T, y: by2 + ny * T - ey * T }, end: { x: bx2 - nx * T + ex * T, y: by2 - ny * T + ey * T }, thickness: 0.6, color });

    let angleDeg = Math.atan2(ey, ex) * (180 / Math.PI);
    if (angleDeg > 90)  angleDeg -= 180;
    if (angleDeg < -90) angleDeg += 180;
    const aRad = angleDeg * Math.PI / 180;
    const cosA = Math.cos(aRad), sinA = Math.sin(aRad);
    const TOFF = 3.5;
    const tmx = midX + nx * (OFFSET + TOFF);
    const tmy = midY + ny * (OFFSET + TOFF);
    const tx = tmx - (tw / 2) * cosA + (SIZE / 2) * sinA;
    const ty = tmy - (tw / 2) * sinA - (SIZE / 2) * cosA;

    if (hasMapBg) {
      const hw = tw + 4, hh = SIZE + 3;
      page.drawRectangle({ x: tmx - (hw/2)*cosA + (hh/2)*sinA, y: tmy - (hw/2)*sinA - (hh/2)*cosA, width: hw, height: hh, color: rgb(1, 1, 1), opacity: 0.78, rotate: degrees(angleDeg) });
    }
    page.drawText(txt, { x: tx, y: ty, size: SIZE, font, color, rotate: degrees(angleDeg) });

    drawn.push(coteSeg);
  }
}

// ── Déduplication anti-croisement ────────────────────────────────────────────

/** Retourne true si les segments (a1→a2) et (b1→b2) se croisent (hors extrémités proches). */
function seg2dCross(
  a1: [number, number], a2: [number, number],
  b1: [number, number], b2: [number, number],
): boolean {
  const dx1 = a2[0] - a1[0], dy1 = a2[1] - a1[1];
  const dx2 = b2[0] - b1[0], dy2 = b2[1] - b1[1];
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-8) return false;
  const t = ((b1[0] - a1[0]) * dy2 - (b1[1] - a1[1]) * dx2) / denom;
  const s = ((b1[0] - a1[0]) * dy1 - (b1[1] - a1[1]) * dx1) / denom;
  return t > 0.05 && t < 0.95 && s > 0.05 && s < 0.95;
}

// ── Cotes de retrait surfaces → limites ───────────────────────────────────────

/** Projection du point (px,py) sur le segment (ax,ay)-(bx,by) */
function closestPtOnSeg(
  px: number, py: number,
  ax: number, ay: number, bx: number, by: number,
): [number, number] {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-10) return [ax, ay];
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return [ax + t * dx, ay + t * dy];
}

/**
 * Pour un polygone (shape) et un segment de limite (parcelle),
 * retourne la paire de points la plus proche + la distance en PDF points.
 * Retourne null si les deux géométries se touchent/croisent (dist < 1 pt).
 */
function closestShapeToSeg(
  shPts: [number, number][],
  ax: number, ay: number, bx: number, by: number,
): { ptShape: [number, number]; ptParcel: [number, number]; dist: number } | null {
  let best = Infinity;
  let ptShape: [number, number] = [0, 0];
  let ptParcel: [number, number] = [0, 0];
  const n = shPts.length;

  // Chaque vertex de la shape → segment de parcelle
  for (let i = 0; i < n; i++) {
    const [px, py] = shPts[i];
    const cp = closestPtOnSeg(px, py, ax, ay, bx, by);
    const d = Math.sqrt((px - cp[0]) ** 2 + (py - cp[1]) ** 2);
    if (d < best) { best = d; ptShape = [px, py]; ptParcel = cp; }
  }

  // Chaque vertex du segment de parcelle → arêtes de la shape
  for (const [px, py] of [[ax, ay], [bx, by]] as [number, number][]) {
    for (let i = 0; i < n; i++) {
      const [sx, sy] = shPts[i], [sx2, sy2] = shPts[(i + 1) % n];
      const cp = closestPtOnSeg(px, py, sx, sy, sx2, sy2);
      const d = Math.sqrt((px - cp[0]) ** 2 + (py - cp[1]) ** 2);
      if (d < best) { best = d; ptParcel = [px, py]; ptShape = cp; }
    }
  }

  if (best < 1) return null; // contact ou croisement
  return { ptShape, ptParcel, dist: best };
}

/**
 * Dessine les lignes de retrait entre chaque surface et chaque arête
 * de la parcelle, en surlignant la cote la plus défavorable par surface.
 */
function drawSetbacks(
  page: PDFPage,
  font: PDFFont,
  shPts: [number, number][],
  parcelPts: [number, number][],
  scale: number,
  pluRules: PluRules,
  hasMapBg: boolean,
  drawn: Seg2[] = [],
): void {
  const nParc = parcelPts.length;
  const requiredMin = Math.min(
    pluRules.retraitVoirie   > 0 ? pluRules.retraitVoirie   : Infinity,
    pluRules.retraitLateral  > 0 ? pluRules.retraitLateral  : Infinity,
    pluRules.retraitFond     > 0 ? pluRules.retraitFond     : Infinity,
  );
  const requiredMax = Math.max(
    pluRules.retraitVoirie,
    pluRules.retraitLateral,
    pluRules.retraitFond,
  );
  const threshPt = Math.max(requiredMax * 2.5, 10) * scale;

  // Collecte les candidats, trie du plus défavorable (le plus court) au plus long
  const candidates: { ptShape: [number,number]; ptParcel: [number,number]; dist: number; distM: number }[] = [];
  for (let j = 0; j < nParc; j++) {
    const [ax, ay] = parcelPts[j];
    const [bx, by] = parcelPts[(j + 1) % nParc];
    const r = closestShapeToSeg(shPts, ax, ay, bx, by);
    if (!r) continue;
    const distM = r.dist / scale;
    if (r.dist > threshPt || distM < 0.05) continue;
    candidates.push({ ...r, distM });
  }
  if (candidates.length === 0) return;

  candidates.sort((a, b) => a.distM - b.distM);

  // Greedy : on retient un candidat seulement s'il ne croise aucun segment déjà gardé/dessiné
  const kept: typeof candidates = [];
  for (const c of candidates) {
    const seg: Seg2 = [c.ptShape, c.ptParcel];
    if (drawn.some(([p1, p2]) => seg2dCross(p1, p2, seg[0], seg[1]))) continue;
    kept.push(c);
    drawn.push(seg);
  }
  if (kept.length === 0) return;

  const minDist = kept[0].distM;

  for (const c of kept) {
    const { ptShape, ptParcel, distM } = c;
    const isWorst = Math.abs(distM - minDist) < 0.01;

    const col = distM < requiredMin
      ? rgb(0.88, 0.18, 0.18)
      : distM < requiredMax
        ? rgb(0.85, 0.52, 0.05)
        : rgb(0.22, 0.38, 0.72);

    const thick = isWorst ? 0.7 : 0.45;
    const dash  = isWorst ? [4, 2] : [2.5, 2];

    page.drawLine({
      start: { x: ptShape[0], y: ptShape[1] },
      end:   { x: ptParcel[0], y: ptParcel[1] },
      thickness: thick, color: col, dashArray: dash,
    });
    page.drawCircle({ x: ptShape[0],  y: ptShape[1],  size: 1.8, color: col });
    page.drawCircle({ x: ptParcel[0], y: ptParcel[1], size: 1.8, color: col });

    const mx = (ptShape[0] + ptParcel[0]) / 2;
    const my = (ptShape[1] + ptParcel[1]) / 2;
    const txt = fmtM(distM);
    const tw  = font.widthOfTextAtSize(txt, 5.5);
    let ang = Math.atan2(ptParcel[1] - ptShape[1], ptParcel[0] - ptShape[0]) * 180 / Math.PI;
    if (ang > 90)  ang -= 180;
    if (ang < -90) ang += 180;
    const cr = Math.cos(ang * Math.PI / 180), sr = Math.sin(ang * Math.PI / 180);
    const SIZE = 5.5;
    const tx = mx - (tw / 2) * cr + (SIZE / 2) * sr;
    const ty = my - (tw / 2) * sr - (SIZE / 2) * cr;

    const hw = tw + 4, hh = SIZE + 3;
    const hx = mx - (hw / 2) * cr + (hh / 2) * sr;
    const hy = my - (hw / 2) * sr - (hh / 2) * cr;
    page.drawRectangle({ x: hx, y: hy, width: hw, height: hh, color: rgb(1, 1, 1), opacity: hasMapBg ? 0.82 : 0.92, rotate: degrees(ang) });
    page.drawText(txt, { x: tx, y: ty, size: SIZE, font, color: col, rotate: degrees(ang) });
  }
}

// ── Export principal ───────────────────────────────────────────────────────────

export async function exportFaisabilite(data: PdfExportData): Promise<void> {
  const pdfDoc = await PDFDocument.create();
  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const LIGHT   = rgb(0.93, 0.95, 0.91);
  const GREY    = rgb(0.5, 0.62, 0.52);
  const GREEN   = rgb(0.25, 0.78, 0.35);
  const RED     = rgb(0.9, 0.2, 0.2);

  // ════════════════════════════════════════════════════════════════════════════
  // PAGE 1 — Plan de masse (A4 paysage)
  // ════════════════════════════════════════════════════════════════════════════
  const W1 = 842, H1 = 595;
  const page1 = pdfDoc.addPage([W1, H1]);

  // Fond
  page1.drawRectangle({ x: 0, y: 0, width: W1, height: H1, color: rgb(0.07, 0.10, 0.06) });

  // Zone carte
  const MAP_L = 20, MAP_B = 20, MAP_W = 620, MAP_H = H1 - 40;
  page1.drawRectangle({ x: MAP_L, y: MAP_B, width: MAP_W, height: MAP_H, color: rgb(0.95, 0.95, 0.92) });

  // ── Projection métrique ────────────────────────────────────────────────────
  const ring = data.parcelRing;
  const nP = ring.length - 1;
  const centLon = ring.slice(0, nP).reduce((s, p) => s + p[0], 0) / nP;
  const centLat = ring.slice(0, nP).reduce((s, p) => s + p[1], 0) / nP;
  const kl = kLon(centLat);

  // Boîte englobante (en mètres)
  let minMX = Infinity, maxMX = -Infinity, minMY = Infinity, maxMY = -Infinity;
  const updateBB = (lon: number, lat: number) => {
    const mx = (lon - centLon) * kl, my = (lat - centLat) * K_LAT;
    if (mx < minMX) minMX = mx; if (mx > maxMX) maxMX = mx;
    if (my < minMY) minMY = my; if (my > maxMY) maxMY = my;
  };
  for (const [lon, lat] of ring) updateBB(lon, lat);
  for (const sh of data.shapes) for (const [lat, lon] of sh.polygon) updateBB(lon, lat);

  const PAD = 35;
  const scaleX = (MAP_W - 2 * PAD) / Math.max(maxMX - minMX, 1);
  const scaleY = (MAP_H - 2 * PAD) / Math.max(maxMY - minMY, 1);
  const scale = Math.min(scaleX, scaleY);
  const mapCX = MAP_L + MAP_W / 2;
  const mapCY = MAP_B + MAP_H / 2;
  const mCentX = (minMX + maxMX) / 2;
  const mCentY = (minMY + maxMY) / 2;
  const llToPdf = makeLlToPdf(centLon, centLat, mapCX - mCentX * scale, mapCY - mCentY * scale, scale);


  // ── Grille de fond ─────────────────────────────────────────────────────────
  // Espacement adaptatif : 1 m, puis doublement jusqu'à > 5 pt PDF
  let GRID_M = 1;
  while (GRID_M * scale < 5) GRID_M *= 2;
  const gridColor = false ? rgb(0.4, 0.4, 0.38) : rgb(0.85, 0.85, 0.82);
  const gridThick = false ? 0.2 : 0.3;
  const gridStartX = Math.floor(minMX / GRID_M) * GRID_M;
  const gridStartY = Math.floor(minMY / GRID_M) * GRID_M;
  for (let gx = gridStartX; gx <= maxMX + GRID_M; gx += GRID_M) {
    const [px] = llToPdf(centLon + gx / kl, centLat);
    if (px < MAP_L || px > MAP_L + MAP_W) continue;
    page1.drawLine({ start: { x: px, y: MAP_B }, end: { x: px, y: MAP_B + MAP_H }, thickness: gridThick, color: gridColor });
  }
  for (let gy = gridStartY; gy <= maxMY + GRID_M; gy += GRID_M) {
    const [, py] = llToPdf(centLon, centLat + gy / K_LAT);
    if (py < MAP_B || py > MAP_B + MAP_H) continue;
    page1.drawLine({ start: { x: MAP_L, y: py }, end: { x: MAP_L + MAP_W, y: py }, thickness: gridThick, color: gridColor });
  }

  // ── Parcelle ────────────────────────────────────────────────────────────────
  const parcelPts = ring.slice(0, nP).map(([lon, lat]) => llToPdf(lon, lat));
  {
    const parcelOpts = { x: 0 as const, y: H1, borderColor: rgb(0.85, 0.60, 0.15), borderWidth: 2, borderDashArray: [6, 3] };
    if (false) {
      page1.drawSvgPath(pdfPolyToSvg(parcelPts, H1), parcelOpts);
    } else {
      page1.drawSvgPath(pdfPolyToSvg(parcelPts, H1), { ...parcelOpts, color: rgb(0.97, 0.94, 0.85) });
    }
  }

  // ── Zone constructible PLU ────────────────────────────────────────────────
  {
    const { retraitVoirie: rv, retraitLateral: rl, retraitFond: rf } = data.pluRules;
    if (rv > 0 || rl > 0 || rf > 0) {
      const setbacks = classifyEdgeSetbacks(ring, data.accessPoint ?? null, rv, rl, rf);
      const zonePts = computeOffsetPoly(ring, setbacks);
      if (zonePts) {
        // computeOffsetPoly retourne [lat, lon][]
        const zonePdfPts = zonePts.map(([lat, lon]) => llToPdf(lon, lat));
        // Léger remplissage vert + contour tiret vert
        page1.drawSvgPath(pdfPolyToSvg(zonePdfPts, H1), {
          x: 0, y: H1,
          color: rgb(0.18, 0.65, 0.30),
          opacity: false ? 0.08 : 0.12,
          borderColor: rgb(0.12, 0.60, 0.25),
          borderWidth: 1,
          borderDashArray: [5, 3],
          borderOpacity: 0.80,
        });
      }
    }
  }

  // ── Surfaces dessinées ─────────────────────────────────────────────────────
  for (const sh of data.shapes) {
    const cfg = SHAPE_TYPE_CONFIG[sh.type];
    const [r, g, b] = hexToRgb(cfg.color);
    const shPts = sh.polygon.map(([lat, lon]) => llToPdf(lon, lat));
    // Remplissage clair
    page1.drawSvgPath(pdfPolyToSvg(shPts, H1), {
      x: 0, y: H1,
      color: mixWithWhite(cfg.color, 0.55),
      borderColor: rgb(r, g, b),
      borderWidth: 1.5,
    });
    // Label surface au centroïde (avec halo blanc pour lisibilité sur fond carte)
    const n = sh.polygon.length;
    const avgLat = sh.polygon.reduce((s, [lat]) => s + lat, 0) / n;
    const avgLon = sh.polygon.reduce((s, [, lon]) => s + lon, 0) / n;
    const [cx, cy] = llToPdf(avgLon, avgLat);
    const txt = sanitize(`${Math.round(sh.surfaceM2)} m2`);
    const tw = font.widthOfTextAtSize(txt, 7);
    if (false) {
      page1.drawRectangle({ x: cx - tw / 2 - 2, y: cy - 5.5, width: tw + 4, height: 10, color: rgb(1, 1, 1), opacity: 0.75 });
    }
    page1.drawText(txt, { x: cx - tw / 2, y: cy - 3.5, size: 7, font, color: rgb(r, g, b) });
  }

  // Tableau partagé de segments déjà dessinés — évite tout croisement entre cotes et retraits
  const drawnSegs: Seg2[] = [];

  // ── Cotes — limites de parcelle ───────────────────────────────────────────
  drawDims(page1, font, parcelPts, scale, rgb(0.55, 0.38, 0.10), false, drawnSegs);

  // ── Cotes — surfaces dessinées ────────────────────────────────────────────
  for (const sh of data.shapes) {
    const cfg = SHAPE_TYPE_CONFIG[sh.type];
    const [r, g, b] = hexToRgb(cfg.color);
    const shPts = sh.polygon.map(([lat, lon]) => llToPdf(lon, lat));
    drawDims(page1, font, shPts, scale, rgb(r * 0.75, g * 0.75, b * 0.75), false, drawnSegs);
  }

  // ── Retraits — distance de chaque surface aux limites ─────────────────────
  for (const sh of data.shapes) {
    const shPts = sh.polygon.map(([lat, lon]) => llToPdf(lon, lat));
    drawSetbacks(page1, font, shPts, parcelPts, scale, data.pluRules, false, drawnSegs);
  }

  // ── Flèche Nord ────────────────────────────────────────────────────────────
  // Positionnée en bas à droite de la zone carte, avec fond cercle
  const NAX = MAP_L + MAP_W - 22, NAY = MAP_B + 26;
  const NAR = 16; // rayon du cercle de fond
  page1.drawCircle({ x: NAX, y: NAY, size: NAR, color: rgb(0.93, 0.93, 0.91) });
  // Triangle plein vers le haut (pointe en haut)
  page1.drawSvgPath(
    `M ${NAX} ${H1 - (NAY + NAR - 3)} L ${NAX - 5} ${H1 - (NAY + 2)} L ${NAX} ${H1 - (NAY + 7)} L ${NAX + 5} ${H1 - (NAY + 2)} Z`,
    { x: 0, y: H1, color: rgb(0.1, 0.15, 0.1) },
  );
  const nw = fontBold.widthOfTextAtSize("N", 9);
  page1.drawText("N", {
    x: NAX - nw / 2, y: NAY - NAR + 3, size: 9, font: fontBold, color: rgb(0.1, 0.15, 0.1),
  });

  // ── Barre d'échelle ─────────────────────────────────────────────────────────
  // Valeur de base agréable (5, 10, 20, 50 m...)
  const rawScale = (maxMX - minMX) / 3;
  const exp = Math.pow(10, Math.floor(Math.log10(rawScale)));
  const scaleM = [1, 2, 5, 10].map(f => f * exp).find(v => v >= rawScale / 3) ?? exp * 10;
  const scaleBarLen = scaleM * scale;
  const SBX = MAP_L + 12, SBY = MAP_B + 10;
  const barColor = false ? rgb(0.1, 0.1, 0.08) : rgb(0.2, 0.25, 0.18);
  if (false) {
    page1.drawRectangle({ x: SBX - 3, y: SBY - 7, width: scaleBarLen + 6, height: 20, color: rgb(1, 1, 1), opacity: 0.80 });
  }
  page1.drawLine({ start: { x: SBX, y: SBY }, end: { x: SBX + scaleBarLen, y: SBY }, thickness: 2.5, color: barColor });
  page1.drawLine({ start: { x: SBX, y: SBY - 3 }, end: { x: SBX, y: SBY + 3 }, thickness: 1.5, color: barColor });
  page1.drawLine({ start: { x: SBX + scaleBarLen, y: SBY - 3 }, end: { x: SBX + scaleBarLen, y: SBY + 3 }, thickness: 1.5, color: barColor });
  const scaleLabel = scaleM >= 1000 ? `${scaleM / 1000} km` : `${scaleM} m`;
  page1.drawText(scaleLabel, {
    x: SBX + scaleBarLen / 2 - font.widthOfTextAtSize(scaleLabel, 7) / 2,
    y: SBY + 5, size: 7, font, color: barColor,
  });

  // ── Panneau droit ───────────────────────────────────────────────────────────
  const PX = MAP_L + MAP_W + 12;
  const PANEL_W = W1 - PX - 10;

  const pw = (text: string, x: number, yTop: number, size: number, bold = false, color: Color = LIGHT) => {
    page1.drawText(sanitize(text), { x, y: yTop - size, size, font: bold ? fontBold : font, color });
  };

  // Logo société (rasterisation SVG → PNG → pdf-lib)
  const LOGO_W = PANEL_W, LOGO_H = Math.round(PANEL_W / 2); // ratio 2:1 du viewBox 800×400
  const logoBytes = await rasterizeSvgLogo(LOGO_W, LOGO_H);
  const logoEmbed = logoBytes ? await pdfDoc.embedPng(logoBytes).catch(() => null) : null;

  // Bord supérieur du logo aligné sur le bord supérieur de la zone carte
  const MAP_TOP = MAP_B + MAP_H; // = 575
  let panY: number;
  if (logoEmbed) {
    const LY = MAP_TOP - LOGO_H;
    page1.drawRectangle({ x: PX - 2, y: LY - 2, width: LOGO_W + 4, height: LOGO_H + 4, color: rgb(0.95, 0.95, 0.92) });
    page1.drawImage(logoEmbed, { x: PX, y: LY, width: LOGO_W, height: LOGO_H });
    panY = LY - 14;
  } else {
    panY = MAP_TOP - 25;
  }

  pw("ÉTUDE DE", PX, panY, 11, true, rgb(0.77, 0.64, 0.35)); panY -= 13;
  pw("FAISABILITÉ", PX, panY, 11, true, rgb(0.77, 0.64, 0.35)); panY -= 18;
  pw("PLAN DE MASSE", PX, panY, 7, false, GREY); panY -= 14;

  // Adresse
  const addrLines = wrapText(data.address, font, W1 - PX - 10, 7);
  for (const l of addrLines.slice(0, 3)) { pw(l, PX, panY, 7, false, rgb(0.7, 0.75, 0.7)); panY -= 9; }
  panY -= 4;

  page1.drawLine({ start: { x: PX, y: panY }, end: { x: W1 - 10, y: panY }, thickness: 0.5, color: GREY });
  panY -= 10;

  pw("Parcelle", PX, panY, 7, false, GREY);
  pw(data.parcelId, PX + 52, panY, 7, true); panY -= 10;
  pw("Surface", PX, panY, 7, false, GREY);
  pw(`${Math.round(data.parcelSurface)} m²`, PX + 52, panY, 7, true); panY -= 14;

  page1.drawLine({ start: { x: PX, y: panY }, end: { x: W1 - 10, y: panY }, thickness: 0.5, color: GREY });
  panY -= 10;

  pw("LÉGENDE", PX, panY, 7.5, true, GREY); panY -= 12;

  // Parcelle cadastrale
  page1.drawRectangle({ x: PX, y: panY - 7, width: 10, height: 7, borderColor: rgb(0.55, 0.43, 0.18), borderWidth: 1, color: rgb(0.97, 0.94, 0.85) });
  pw("Parcelle cadastrale", PX + 13, panY, 6.5); panY -= 11;

  // Zone constructible PLU
  {
    const { retraitVoirie: rv, retraitLateral: rl, retraitFond: rf } = data.pluRules;
    if (rv > 0 || rl > 0 || rf > 0) {
      page1.drawLine({ start: { x: PX, y: panY - 4 }, end: { x: PX + 10, y: panY - 4 }, thickness: 1, color: rgb(0.12, 0.60, 0.25), dashArray: [4, 2] });
      pw("Zone constructible PLU", PX + 13, panY, 6.5, false, rgb(0.12, 0.60, 0.25)); panY -= 11;
    }
  }

  // Surfaces
  for (const sh of data.shapes) {
    if (panY < MAP_B + 30) break;
    const cfg = SHAPE_TYPE_CONFIG[sh.type];
    const [r, g, b] = hexToRgb(cfg.color);
    page1.drawRectangle({ x: PX, y: panY - 7, width: 10, height: 7, color: rgb(r, g, b) });
    const shLabel = `${sh.label} ${Math.round(sh.surfaceM2)} m²`;
    pw(shLabel, PX + 13, panY, 6.5); panY -= 10;
  }

  panY -= 8;
  const dateStr = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  pw(`Généré le ${dateStr}`, PX, MAP_B + 22, 6, false, GREY);
  pw("Résultats indicatifs", PX, MAP_B + 13, 5.5, false, rgb(0.35, 0.45, 0.36));

  // ════════════════════════════════════════════════════════════════════════════
  // PAGE 2 — Conformité PLU (A4 portrait)
  // ════════════════════════════════════════════════════════════════════════════
  const W2 = 595, H2 = 842;
  const page2 = pdfDoc.addPage([W2, H2]);
  page2.drawRectangle({ x: 0, y: 0, width: W2, height: H2, color: rgb(0.07, 0.10, 0.06) });

  const ctx: Page2Context = { page: page2, font, fontBold, W: W2, H: H2, cy: 0, COL_L: 30, COL_W: W2 - 60 };

  // En-tête
  page2.drawRectangle({ x: 0, y: H2 - 70, width: W2, height: 70, color: rgb(0.08, 0.18, 0.10) });
  p2text(ctx, "Étude de faisabilité — Conformité PLU", ctx.COL_L, 18, 13, true);
  p2text(ctx, data.address || "—", ctx.COL_L, 34, 8, false, GREY);
  p2text(ctx, `Parcelle ${data.parcelId} · ${Math.round(data.parcelSurface)} m²`, ctx.COL_L, 45, 8, false, GREY);

  ctx.cy = 82;

  // ── Score ─────────────────────────────────────────────────────────────────
  const { conformite: c } = data;

  // Items numériques à vérifier
  const numItems: { label: string; ok: boolean }[] = [
    { label: "Emprise au sol", ok: c.empriseSol.conforme },
    { label: "Espaces verts", ok: c.espacesVerts.conforme },
    { label: "Hauteur bât. principal", ok: c.hauteurMax.conforme },
  ];
  if (c.hauteurAnnexe.applique)   numItems.push({ label: "Hauteur annexe",      ok: c.hauteurAnnexe.conforme });
  if (c.surfaceAnnexe.applique)   numItems.push({ label: "Surface annexe",      ok: c.surfaceAnnexe.conforme });
  if (c.longueurAnnexe.applique)  numItems.push({ label: "Longueur annexe",     ok: c.longueurAnnexe.conforme });
  if (c.retraitMin.applique)      numItems.push({ label: "Retrait latéral",     ok: c.retraitMin.conforme });
  if (c.retraitFond.applique)     numItems.push({ label: "Retrait fond",        ok: c.retraitFond.conforme });
  if (isFinite(data.minSetbackVoirie)) {
    numItems.push({ label: "Retrait voirie — principal", ok: data.minSetbackVoirie >= data.pluRules.retraitVoirie });
  }
  if (isFinite(data.minSetbackVoirieAnnexe)) {
    const rvA = data.pluRules.retraitVoirieAnnexe > 0 ? data.pluRules.retraitVoirieAnnexe : data.pluRules.retraitVoirie;
    numItems.push({ label: "Retrait voirie — annexe", ok: data.minSetbackVoirieAnnexe < 0.20 || data.minSetbackVoirieAnnexe >= rvA });
  }

  const nbOk = numItems.filter(i => i.ok).length;
  const nbTotal = numItems.length;

  const scoreColor = nbOk === nbTotal ? GREEN : nbOk >= nbTotal / 2 ? rgb(0.85, 0.6, 0.1) : RED;
  p2text(ctx, `${nbOk} / ${nbTotal}`, ctx.COL_L, ctx.cy, 28, true, scoreColor); ctx.cy += 2;
  p2text(ctx, "règles numériques conformes", ctx.COL_L + 62, ctx.cy + 2, 9, false, GREY);

  // Aspect rules count
  const aspectFields = [
    { key: "aspectToiture",    label: "Toiture"     },
    { key: "aspectTuiles",     label: "Tuiles / couverture" },
    { key: "aspectMenuiseries",label: "Menuiseries" },
    { key: "aspectClotures",   label: "Clôtures"    },
    { key: "aspectVegetaux",   label: "Végétaux"    },
    { key: "aspectPiscine",    label: "Piscine / bassin" },
    { key: "aspectTerrasses",  label: "Terrasses"   },
  ] as const;
  const aspectFilled = aspectFields.filter(f => data.pluRules[f.key as keyof PluRules]);
  if (aspectFilled.length) {
    ctx.cy += 36;
    p2text(ctx, `+ ${aspectFilled.length} règle(s) d'aspect à respecter (voir ci-dessous)`, ctx.COL_L, ctx.cy, 7.5, false, rgb(0.82, 0.62, 0.18));
    ctx.cy += 10;
  } else {
    ctx.cy += 38;
  }

  drawHRule(ctx, true);

  // ── Surfaces ─────────────────────────────────────────────────────────────
  drawSectionTitle(ctx, "SURFACES ET EMPRISE");
  drawRule(ctx, "Emprise au sol",
    c.empriseSol.conforme,
    `${c.empriseSol.valeur.toFixed(0)}% / ${c.empriseSol.max}%`);
  drawRule(ctx, "Surface plancher (indicatif)",
    null,
    `${c.surfacePlancher.valeur.toFixed(0)} m²`);
  drawRule(ctx, "Espaces verts",
    c.espacesVerts.conforme,
    `${c.espacesVerts.valeur.toFixed(0)}% / min ${c.espacesVerts.min}%`);
  drawHRule(ctx);

  // ── Distances ────────────────────────────────────────────────────────────
  drawSectionTitle(ctx, "DISTANCES ET RETRAITS");
  if (c.retraitMin.applique) {
    drawRule(ctx, "Retrait limites latérales",
      c.retraitMin.enLimite || c.retraitMin.conforme,
      c.retraitMin.enLimite ? "EN LIMITE" : `${c.retraitMin.valeur.toFixed(1)} m / ${c.retraitMin.requis} m`);
  }
  if (c.retraitFond.applique) {
    drawRule(ctx, "Retrait fond de parcelle",
      c.retraitFond.conforme,
      `${c.retraitFond.valeur.toFixed(1)} m / ${c.retraitFond.requis} m`);
  }
  if (isFinite(data.minSetbackVoirie)) {
    drawRule(ctx, "Retrait voirie — bâtiment principal",
      data.minSetbackVoirie >= data.pluRules.retraitVoirie,
      `${data.minSetbackVoirie.toFixed(1)} m / ${data.pluRules.retraitVoirie} m`);
  }
  if (isFinite(data.minSetbackVoirieAnnexe)) {
    const rvA = data.pluRules.retraitVoirieAnnexe > 0 ? data.pluRules.retraitVoirieAnnexe : data.pluRules.retraitVoirie;
    const enLimA = data.minSetbackVoirieAnnexe < 0.20;
    drawRule(ctx, "Retrait voirie — annexes",
      enLimA || data.minSetbackVoirieAnnexe >= rvA,
      enLimA ? "EN LIMITE" : `${data.minSetbackVoirieAnnexe.toFixed(1)} m / ${rvA} m`);
  }
  drawHRule(ctx);

  // ── Hauteurs ─────────────────────────────────────────────────────────────
  drawSectionTitle(ctx, "HAUTEURS");
  if (c.hauteurMax.valeur > 0) {
    drawRule(ctx, "Bâtiment principal", c.hauteurMax.conforme,
      `${c.hauteurMax.valeur.toFixed(1)} m / ${c.hauteurMax.max} m`);
  }
  if (c.hauteurAnnexe.applique) {
    drawRule(ctx, "Annexes / dépendances", c.hauteurAnnexe.conforme,
      `${c.hauteurAnnexe.valeur.toFixed(1)} m / ${c.hauteurAnnexe.max} m`);
  }
  if (c.surfaceAnnexe.applique) {
    drawRule(ctx, "Surface max une annexe", c.surfaceAnnexe.conforme,
      `${c.surfaceAnnexe.valeur.toFixed(0)} m² / ${c.surfaceAnnexe.max} m²`);
  }
  if (c.longueurAnnexe.applique) {
    drawRule(ctx, "Longueur max une annexe", c.longueurAnnexe.conforme,
      `${c.longueurAnnexe.valeur.toFixed(1)} m / ${c.longueurAnnexe.max} m`);
  }
  drawHRule(ctx);

  // ── Récapitulatif volumes ─────────────────────────────────────────────────
  drawSectionTitle(ctx, "VOLUMES PROJETÉS");
  drawRule(ctx, "Emprise sol totale", null, `${Math.round(data.empriseSol)} m²`);
  drawRule(ctx, "Surface plancher totale", null, `${Math.round(data.surfacePlancher)} m²`);
  for (const sh of data.shapes) {
    const cfg = SHAPE_TYPE_CONFIG[sh.type];
    drawRule(ctx, `${cfg.label} — ${sh.label}`, null, `${Math.round(sh.surfaceM2)} m² · H ${sh.hauteurFaitage.toFixed(1)} m`);
  }

  // ── Règles d'aspect ───────────────────────────────────────────────────────
  if (aspectFilled.length) {
    drawHRule(ctx, true);
    drawSectionTitle(ctx, "RÈGLES D'ASPECT (qualitatives — à vérifier avec le service urbanisme)");

    for (const { key, label } of aspectFilled) {
      const val = data.pluRules[key as keyof PluRules] as string;
      if (!val) continue;

      // Titre de la règle
      p2text(ctx, label, ctx.COL_L + 8, ctx.cy, 8, true, GREY); ctx.cy += 11;

      // Valeur avec enveloppe
      const lines = wrapText(val, font, ctx.COL_W - 20, 7.5);
      for (const l of lines) {
        if (ctx.cy > H2 - 40) break;
        p2text(ctx, l, ctx.COL_L + 18, ctx.cy, 7.5); ctx.cy += 10;
      }
      ctx.cy += 3;
    }
  }

  // ── Pied de page ─────────────────────────────────────────────────────────
  page2.drawLine({ start: { x: ctx.COL_L, y: 30 }, end: { x: W2 - ctx.COL_L, y: 30 }, thickness: 0.3, color: GREY });
  page2.drawText(sanitize("Resultats indicatifs - ne constituent pas un avis juridique ou administratif."), {
    x: ctx.COL_L, y: 18, size: 6, font, color: rgb(0.35, 0.45, 0.36),
  });
  const dw = font.widthOfTextAtSize(sanitize(dateStr), 6);
  page2.drawText(sanitize(dateStr), { x: W2 - ctx.COL_L - dw, y: 18, size: 6, font, color: GREY });

  // ── Enregistrer et télécharger ────────────────────────────────────────────
  const pdfBytes = await pdfDoc.save();
  // .slice(0) creates a copy typed as Uint8Array<ArrayBuffer> — compatible with BlobPart
  const blob = new Blob([pdfBytes.slice(0)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `etude-faisabilite-${data.parcelId || "plan"}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
