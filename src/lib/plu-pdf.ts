import { PDFDocument, PDFPage, PDFFont, PDFImage, StandardFonts, rgb, PageSizes } from "pdf-lib";
import type { RGB } from "pdf-lib";
import { readFile } from "fs/promises";
import { join } from "path";
import sharp from "sharp";
import { _kLon } from "./zoneUtils";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PdfReportData {
  // Projet
  prenom: string;
  nom: string;
  adresseProjet: string;
  commune: string;
  parcelRef: string;
  parcelSurface: number;
  projectTypeLabel: string;
  // Surfaces
  existingM2: number;
  drawnM2: number;
  totalM2: number;
  empriseP: number;
  // Geometrie
  parcelRing: [number, number][] | undefined;   // [lon, lat][] GeoJSON
  zoneMain: [number, number][] | null;           // [lat, lon][]
  zoneAnnex: [number, number][] | null;          // [lat, lon][]
  drawnShapes: {
    label: string;
    type: string;
    surfaceM2: number;
    niveaux?: string;
    polygon: [number, number][];                 // [lat, lon][]
  }[];
  // Analyse IA
  aiAnalysis: {
    retraitVoie: number;
    retraitLateral: number;
    retraitFond: number;
    empriseMax: number;
    empriseNonReglementee?: boolean;
    hauteurMax: number;
    parkingNombrePlaces: number;
    resume?: string;
    recommandation?: string;
    avertissement?: string;
  } | null;
}

// ── Couleurs ──────────────────────────────────────────────────────────────────

const C_VERT: RGB = rgb(0.086, 0.639, 0.255);
const C_BLEU: RGB = rgb(0.035, 0.569, 0.698);
const C_TERRA: RGB = rgb(0.71, 0.396, 0.114);
const C_GRIS: RGB = rgb(0.3, 0.3, 0.3);
const C_GRIS_LIGHT: RGB = rgb(0.9, 0.9, 0.9);
const C_BLACK: RGB = rgb(0, 0, 0);
const C_WHITE: RGB = rgb(1, 1, 1);
const C_BLUE_SHAPE: RGB = rgb(0.18, 0.45, 0.8);
const C_YELLOW_SHAPE: RGB = rgb(0.85, 0.75, 0.1);
const C_CYAN_SHAPE: RGB = rgb(0.1, 0.7, 0.8);
const C_ORANGE_SHAPE: RGB = rgb(0.9, 0.5, 0.1);



// ── Fond de carte OSM ────────────────────────────────────────────────────────

function lonLatToTileXY(lon: number, lat: number, z: number) {
  const n = Math.pow(2, z);
  const x = (lon + 180) / 360 * n;
  const latRad = lat * Math.PI / 180;
  const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
  return { tx: Math.floor(x), ty: Math.floor(y), fx: x - Math.floor(x), fy: y - Math.floor(y) };
}

async function fetchMapBackground(
  parcelRing: [number, number][], // [lon, lat][]
  widthPx: number,
  heightPx: number,
): Promise<Buffer | null> {
  try {
    const lons = parcelRing.map(([lon]) => lon);
    const lats = parcelRing.map(([, lat]) => lat);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const centerLon = (minLon + maxLon) / 2;
    const centerLat = (minLat + maxLat) / 2;

    const kLat = 111320;
    const kLon = kLat * Math.cos(centerLat * Math.PI / 180);

    // Échelle identique à makeTransform (facteur 0.85) pour aligner les polygones avec le fond
    const rangeX = (maxLon - minLon) * kLon || 1;
    const rangeY = (maxLat - minLat) * kLat || 1;
    const scalePxPerM = Math.min(widthPx / rangeX, heightPx / rangeY) * 0.85;
    const idealMpp = 1 / scalePxPerM; // mètres par pixel souhaité

    // OSM plafonne à zoom 19 — on reste en dessous puis on recadre/zoom le mosaïque
    const zoom = Math.min(19, Math.max(14, Math.round(Math.log2(156543 * Math.cos(centerLat * Math.PI / 180) / idealMpp))));
    const actualMpp = 156543 * Math.cos(centerLat * Math.PI / 180) / Math.pow(2, zoom);

    const center = lonLatToTileXY(centerLon, centerLat, zoom);
    const tilesX = Math.min(4, Math.ceil(widthPx / 256) + 1);
    const tilesY = Math.min(4, Math.ceil(heightPx / 256) + 1);
    const mosaicW = tilesX * 256;
    const mosaicH = tilesY * 256;
    const startTX = center.tx - Math.floor(tilesX / 2);
    const startTY = center.ty - Math.floor(tilesY / 2);
    const centerXInMosaic = (center.tx - startTX + center.fx) * 256;
    const centerYInMosaic = (center.ty - startTY + center.fy) * 256;

    const maxTile = Math.pow(2, zoom);
    const overlays: { input: Buffer; left: number; top: number }[] = [];

    await Promise.all(
      Array.from({ length: tilesY }, (_, dy) =>
        Array.from({ length: tilesX }, (_, dx) => {
          const tx = startTX + dx, ty = startTY + dy;
          if (tx < 0 || ty < 0 || tx >= maxTile || ty >= maxTile) return null;
          return fetch(`https://tile.openstreetmap.org/${zoom}/${tx}/${ty}.png`, {
            headers: { "User-Agent": "Metaconception-PLU-PDF/1.0 (contact@metaconception.eu)" },
          })
            .then((r) => r.ok ? r.arrayBuffer() : null)
            .then((ab) => { if (ab) overlays.push({ input: Buffer.from(ab), left: dx * 256, top: dy * 256 }); })
            .catch(() => null);
        }),
      ).flat(),
    );

    if (overlays.length === 0) return null;

    const mosaic = await sharp({
      create: { width: mosaicW, height: mosaicH, channels: 3, background: { r: 241, g: 238, b: 232 } },
    }).composite(overlays).png().toBuffer();

    // Recadre en fonction de l'écart entre zoom réel et zoom idéal (aligne l'échelle)
    const cropW = Math.round(widthPx * idealMpp / actualMpp);
    const cropH = Math.round(heightPx * idealMpp / actualMpp);
    const left = Math.max(0, Math.min(Math.round(centerXInMosaic - cropW / 2), mosaicW - cropW));
    const top  = Math.max(0, Math.min(Math.round(centerYInMosaic - cropH / 2), mosaicH - cropH));
    const safeW = Math.min(cropW, mosaicW - left);
    const safeH = Math.min(cropH, mosaicH - top);

    return sharp(mosaic)
      .extract({ left, top, width: safeW, height: safeH })
      .resize(widthPx, heightPx, { fit: "fill" })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

// ── Utilitaires de transformation ─────────────────────────────────────────────

interface DrawArea { x: number; y: number; w: number; h: number }

function makeTransform(
  allRings: [number, number][][],
  area: DrawArea,
  isLatLon: boolean, // true si [lat, lon], false si [lon, lat]
): ([a, b]: [number, number]) => [number, number] {
  const kLat = 111320;
  const pts = allRings.flat();
  if (pts.length === 0) return () => [area.x, area.y];

  const lats = isLatLon ? pts.map(([a]) => a) : pts.map(([, b]) => b);
  const lons = isLatLon ? pts.map(([, b]) => b) : pts.map(([a]) => a);

  const avgLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kLon = _kLon(avgLat);

  const minX = Math.min(...lons) * kLon, maxX = Math.max(...lons) * kLon;
  const minY = Math.min(...lats) * kLat, maxY = Math.max(...lats) * kLat;
  const rangeX = maxX - minX || 1, rangeY = maxY - minY || 1;
  const scale = Math.min(area.w / rangeX, area.h / rangeY) * 0.85;
  const offX = area.x + (area.w - rangeX * scale) / 2;
  const offY = area.y + (area.h - rangeY * scale) / 2;

  return ([a, b]: [number, number]): [number, number] => {
    const lat = isLatLon ? a : b;
    const lon = isLatLon ? b : a;
    return [
      offX + (lon * kLon - minX) * scale,
      offY + (lat * kLat - minY) * scale,
    ];
  };
}

// ── Dessin de polygones ───────────────────────────────────────────────────────

function drawPolygonOnPage(
  page: PDFPage,
  pts: [number, number][],
  transform: ([a, b]: [number, number]) => [number, number],
  opts: {
    fillColor?: RGB;
    strokeColor?: RGB;
    fillOpacity?: number;
    strokeWidth?: number;
  },
) {
  if (pts.length < 3) return;

  // drawSvgPath applies: Y_PDF = y_option - py_svg
  // makeTransform returns PDF coords (y=0 bottom, increases up).
  // So: py_svg = pageH - y_pdf, and we pass y_option = pageH → Y_PDF = pageH - (pageH - y_pdf) = y_pdf ✓
  const { height: pageH } = page.getSize();
  const transformed = pts.map((pt) => transform(pt));

  const pathParts = transformed.map(([x, y], i) =>
    `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${(pageH - y).toFixed(1)}`
  );
  const svgPath = pathParts.join(" ") + " Z";

  try {
    page.drawSvgPath(svgPath, {
      x: 0,
      y: pageH,
      color: opts.fillColor,
      borderColor: opts.strokeColor ?? C_GRIS,
      borderWidth: opts.strokeWidth ?? 1,
      opacity: opts.fillOpacity ?? 1,
      borderOpacity: 1, // stroke always fully visible, independent of fill opacity
    });
  } catch {
    for (let i = 0; i < transformed.length; i++) {
      const [x1, y1] = transformed[i];
      const [x2, y2] = transformed[(i + 1) % transformed.length];
      page.drawLine({
        start: { x: x1, y: y1 },
        end: { x: x2, y: y2 },
        thickness: opts.strokeWidth ?? 1,
        color: opts.strokeColor ?? C_GRIS,
      });
    }
  }
}

// ── Helpers texte ─────────────────────────────────────────────────────────────

function sanitizeText(text: string): string {
  // Helvetica (WinAnsiEncoding) — remplace les caractères hors Latin-1
  return text
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/–/g, "-")
    .replace(/—/g, "--")
    .replace(/…/g, "...")
    .replace(/[^\x00-\xFF]/g, "?");
}

function truncateText(text: string, font: { widthOfTextAtSize: (t: string, s: number) => number }, size: number, maxWidth: number): string {
  const s = sanitizeText(text);
  if (font.widthOfTextAtSize(s, size) <= maxWidth) return s;
  let result = s;
  while (result.length > 0 && font.widthOfTextAtSize(result + "...", size) > maxWidth) {
    result = result.slice(0, -1);
  }
  return result + "...";
}

// ── Page 1 — Plan zones constructibles ────────────────────────────────────────

function drawPageHeader(
  page: PDFPage,
  width: number,
  height: number,
  subtitle: string,
  addressLine: string,
  helvetica: PDFFont,
  helveticaBold: PDFFont,
  logoImage: PDFImage | null,
) {
  page.drawRectangle({ x: 0, y: height - 60, width, height: 60, color: rgb(0.133, 0.118, 0.094) });

  if (logoImage) {
    const logoNatW = logoImage.width;
    const logoNatH = logoImage.height;
    const maxH = 40;
    const maxW = 100;
    const scale = Math.min(maxH / logoNatH, maxW / logoNatW);
    const logoW = logoNatW * scale;
    const logoH = logoNatH * scale;
    const logoX = width - logoW - 12;
    const logoY = height - 60 + (60 - logoH) / 2;
    page.drawImage(logoImage, { x: logoX, y: logoY, width: logoW, height: logoH });
  } else {
    page.drawText("METACONCEPTION", {
      x: 40, y: height - 28, size: 14, font: helveticaBold, color: C_WHITE,
    });
  }

  page.drawText(subtitle, {
    x: 40, y: height - (logoImage ? 45 : 45), size: 8, font: helvetica, color: rgb(0.541, 0.502, 0.439),
  });
  if (addressLine) {
    page.drawText(sanitizeText(addressLine), {
      x: logoImage ? 40 : 280, y: height - (logoImage ? 28 : 34), size: logoImage ? 11 : 9,
      font: logoImage ? helveticaBold : helvetica, color: C_WHITE,
    });
  }
}

async function drawPage1(
  pdfDoc: PDFDocument,
  data: PdfReportData,
  helvetica: PDFFont,
  helveticaBold: PDFFont,
  logoImage: PDFImage | null,
  mapImage: PDFImage | null = null,
) {
  const page = pdfDoc.addPage(PageSizes.A4);
  const { width, height } = page.getSize(); // 595 x 842

  // En-tête
  drawPageHeader(page, width, height, "PLAN DES ZONES CONSTRUCTIBLES", data.adresseProjet, helvetica, helveticaBold, logoImage);

  // Zone de plan
  const area: DrawArea = { x: 40, y: 75, w: 515, h: 660 };

  // Construire la liste des anneaux [lat, lon]
  const parcelLatLon: [number, number][] | null = data.parcelRing
    ? data.parcelRing.map(([lon, lat]) => [lat, lon] as [number, number])
    : null;

  const allRings: [number, number][][] = [];
  if (parcelLatLon) allRings.push(parcelLatLon);
  if (data.zoneMain) allRings.push(data.zoneMain);
  if (data.zoneAnnex) allRings.push(data.zoneAnnex);

  if (allRings.length > 0) {
    const tf = makeTransform(allRings, area, true);

    // Fond de zone (carte OSM ou gris)
    page.drawRectangle({
      x: area.x, y: area.y, width: area.w, height: area.h,
      color: rgb(0.97, 0.97, 0.97), borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.5,
    });
    if (mapImage) {
      page.drawImage(mapImage, { x: area.x, y: area.y, width: area.w, height: area.h });
    }

    // Zone annexes (bleu, fond)
    if (data.zoneAnnex && data.zoneAnnex.length >= 3) {
      drawPolygonOnPage(page, data.zoneAnnex, tf, {
        fillColor: C_BLEU, strokeColor: C_BLEU, fillOpacity: 0.2, strokeWidth: 1.5,
      });
    }

    // Zone principale (vert, fond)
    if (data.zoneMain && data.zoneMain.length >= 3) {
      drawPolygonOnPage(page, data.zoneMain, tf, {
        fillColor: C_VERT, strokeColor: C_VERT, fillOpacity: 0.2, strokeWidth: 1.5,
      });
    }

    // Parcelle (contour noir)
    if (parcelLatLon && parcelLatLon.length >= 3) {
      drawPolygonOnPage(page, parcelLatLon, tf, {
        strokeColor: C_GRIS, strokeWidth: 2, fillOpacity: 0,
      });
    }
  } else {
    page.drawRectangle({
      x: area.x, y: area.y, width: area.w, height: area.h,
      color: rgb(0.95, 0.95, 0.95), borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 1,
    });
    page.drawText("Geometrie non disponible", {
      x: area.x + area.w / 2 - 60, y: area.y + area.h / 2, size: 10, font: helvetica, color: C_GRIS,
    });
  }

  // Legende
  const legY = 58;
  const items: { color: RGB; label: string }[] = [
    { color: C_GRIS, label: "Parcelle" },
  ];
  if (data.zoneMain) items.push({ color: C_VERT, label: "Zone constructible principale" });
  if (data.zoneAnnex) items.push({ color: C_BLEU, label: "Zone annexes" });

  let legX = 67;
  for (const item of items) {
    page.drawRectangle({ x: legX, y: legY - 8, width: 12, height: 8, color: item.color, borderWidth: 0 });
    page.drawText(sanitizeText(item.label), { x: legX + 16, y: legY - 7, size: 7, font: helvetica, color: C_GRIS });
    legX += 14 + helvetica.widthOfTextAtSize(item.label, 7) + 12;
  }

  // Regles PLU en bas (si disponible)
  if (data.aiAnalysis) {
    const ai = data.aiAnalysis;
    const rulesY = 20;
    const rulesText = [
      `Retrait voie: ${ai.retraitVoie} m`,
      `Retrait lateral: ${ai.retraitLateral} m`,
      `Retrait fond: ${ai.retraitFond} m`,
      `Emprise max: ${ai.empriseNonReglementee ? "NR" : `${ai.empriseMax}%`}`,
      `Hauteur max: ${ai.hauteurMax} m`,
    ].join("   |   ");
    page.drawText(sanitizeText(rulesText), {
      x: 40, y: rulesY, size: 7, font: helvetica, color: C_GRIS,
    });
  }

  // Numero de page
  page.drawText("1 / 3", { x: width - 50, y: 15, size: 7, font: helvetica, color: C_GRIS });
}

// ── Page 2 — Plan projet ──────────────────────────────────────────────────────

async function drawPage2(
  pdfDoc: PDFDocument,
  data: PdfReportData,
  helvetica: PDFFont,
  helveticaBold: PDFFont,
  logoImage: PDFImage | null,
  mapImage: PDFImage | null = null,
) {
  const page = pdfDoc.addPage(PageSizes.A4);
  const { width, height } = page.getSize();

  // En-tete
  drawPageHeader(page, width, height, "PLAN DU PROJET", data.adresseProjet, helvetica, helveticaBold, logoImage);

  // Zone de plan
  const area: DrawArea = { x: 40, y: 110, w: 515, h: 620 };

  const parcelLatLon: [number, number][] | null = data.parcelRing
    ? data.parcelRing.map(([lon, lat]) => [lat, lon] as [number, number])
    : null;

  const allRingsForTf: [number, number][][] = [];
  if (parcelLatLon) allRingsForTf.push(parcelLatLon);
  for (const sh of data.drawnShapes) {
    if (sh.polygon.length >= 3) allRingsForTf.push(sh.polygon);
  }

  const shapeColors: Record<string, RGB> = {
    batiment: C_BLUE_SHAPE,
    extension: C_BLUE_SHAPE,
    garage: C_YELLOW_SHAPE,
    piscine: C_CYAN_SHAPE,
    terrasse: C_ORANGE_SHAPE,
    autre: C_ORANGE_SHAPE,
  };

  if (allRingsForTf.length > 0) {
    const tf = makeTransform(allRingsForTf, area, true);

    // Fond (carte OSM ou gris)
    page.drawRectangle({
      x: area.x, y: area.y, width: area.w, height: area.h,
      color: rgb(0.97, 0.97, 0.97), borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.5,
    });
    if (mapImage) {
      page.drawImage(mapImage, { x: area.x, y: area.y, width: area.w, height: area.h });
    }

    // Parcelle
    if (parcelLatLon && parcelLatLon.length >= 3) {
      drawPolygonOnPage(page, parcelLatLon, tf, {
        strokeColor: C_GRIS, strokeWidth: 2, fillOpacity: 0,
      });
    }

    // Formes projetees
    for (const sh of data.drawnShapes) {
      if (sh.polygon.length < 3) continue;
      const col = shapeColors[sh.type] ?? C_ORANGE_SHAPE;
      drawPolygonOnPage(page, sh.polygon, tf, {
        fillColor: col, strokeColor: col, fillOpacity: 0.35, strokeWidth: 1.5,
      });

      // Label surface au centre
      const center = sh.polygon.reduce(
        ([ax, ay], [lat, lon]) => [ax + lat / sh.polygon.length, ay + lon / sh.polygon.length],
        [0, 0] as [number, number],
      );
      const [cx, cy] = tf(center as [number, number]);
      const labelText = `${sh.surfaceM2} m2`;
      const lw = helvetica.widthOfTextAtSize(labelText, 7);
      page.drawText(labelText, {
        x: cx - lw / 2, y: cy - 3.5,
        size: 7, font: helvetica, color: C_BLACK,
      });
    }
  } else {
    page.drawRectangle({
      x: area.x, y: area.y, width: area.w, height: area.h,
      color: rgb(0.95, 0.95, 0.95), borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 1,
    });
    page.drawText("Geometrie non disponible", {
      x: area.x + area.w / 2 - 60, y: area.y + area.h / 2, size: 10, font: helvetica, color: C_GRIS,
    });
  }

  // Bilan emprise
  const bilanY = 95;
  page.drawText("BILAN EMPRISE", {
    x: 40, y: bilanY, size: 9, font: helveticaBold, color: C_TERRA,
  });

  const bilanItems = [
    `Surface parcelle: ${data.parcelSurface} m2`,
    `Surface projet: ${data.drawnM2} m2`,
    data.existingM2 > 0 ? `Existant: ${data.existingM2} m2` : null,
    `Total: ${data.totalM2} m2`,
    `Emprise: ${data.empriseP}%`,
  ].filter(Boolean) as string[];

  let bx = 40;
  for (const item of bilanItems) {
    page.drawText(sanitizeText(item), { x: bx, y: bilanY - 16, size: 8, font: helvetica, color: C_GRIS });
    bx += helvetica.widthOfTextAtSize(item, 8) + 20;
  }

  // Legende formes
  const legY = 70;
  const shapeTypes = [...new Set(data.drawnShapes.map((s) => s.type))];
  const typeLabels: Record<string, string> = {
    batiment: "Batiment",
    extension: "Extension",
    garage: "Garage",
    piscine: "Piscine",
    terrasse: "Terrasse",
    autre: "Autre",
  };
  let lx = 40;
  for (const t of shapeTypes) {
    const col = shapeColors[t] ?? C_ORANGE_SHAPE;
    page.drawRectangle({ x: lx, y: legY - 8, width: 12, height: 8, color: col, borderWidth: 0 });
    const label = typeLabels[t] ?? t;
    page.drawText(label, { x: lx + 16, y: legY - 7, size: 7, font: helvetica, color: C_GRIS });
    lx += 14 + helvetica.widthOfTextAtSize(label, 7) + 12;
  }

  // Disclaimer bas
  page.drawText("Plan schematique indicatif — non contractuel", {
    x: 40, y: 20, size: 7, font: helvetica, color: rgb(0.6, 0.6, 0.6),
  });
  page.drawText("2 / 3", { x: width - 50, y: 15, size: 7, font: helvetica, color: C_GRIS });
}

// ── Page 3 — Recapitulatif ────────────────────────────────────────────────────

async function drawPage3(
  pdfDoc: PDFDocument,
  data: PdfReportData,
  helvetica: PDFFont,
  helveticaBold: PDFFont,
  logoImage: PDFImage | null,
) {
  const page = pdfDoc.addPage(PageSizes.A4);
  const { width, height } = page.getSize();
  const today = new Date().toLocaleDateString("fr-FR");

  // En-tete
  drawPageHeader(page, width, height, "RECAPITULATIF DE L'ANALYSE PLU", "", helvetica, helveticaBold, logoImage);
  // Date en bas à gauche du header (ne chevauche pas le logo)
  page.drawText(`Genere le ${today}`, {
    x: 40, y: height - 52, size: 7, font: helvetica, color: rgb(0.6, 0.6, 0.6),
  });

  let curY = height - 80;
  const marginL = 40;
  const colW = (width - 80) / 2;

  // ── Bloc Projet ──
  page.drawRectangle({
    x: marginL, y: curY - 120, width: width - 80, height: 120,
    color: rgb(0.961, 0.941, 0.902), borderWidth: 0,
  });
  page.drawRectangle({
    x: marginL, y: curY - 3, width: 3, height: 120,
    color: C_TERRA, borderWidth: 0,
  });
  page.drawText("PROJET", {
    x: marginL + 12, y: curY - 15, size: 8, font: helveticaBold, color: rgb(0.541, 0.502, 0.439),
  });

  const projetRows: [string, string][] = [
    ["Adresse", truncateText(data.adresseProjet, helvetica, 9, colW * 2 - 100)],
    ["Commune", sanitizeText(data.commune)],
    ["Reference parcelle", sanitizeText(data.parcelRef)],
    ["Surface parcelle", `${data.parcelSurface} m2`],
    ["Type de projet", sanitizeText(data.projectTypeLabel)],
  ];

  let rowY = curY - 28;
  for (const [label, val] of projetRows) {
    page.drawText(label, { x: marginL + 12, y: rowY, size: 8, font: helvetica, color: rgb(0.541, 0.502, 0.439) });
    page.drawText(val, { x: marginL + 150, y: rowY, size: 8, font: helveticaBold, color: rgb(0.133, 0.118, 0.094) });
    rowY -= 16;
  }
  curY -= 130;

  // ── Tableau regles PLU ──
  if (data.aiAnalysis) {
    const ai = data.aiAnalysis;
    curY -= 16;
    page.drawText("REGLES PLU APPLICABLES", {
      x: marginL, y: curY, size: 8, font: helveticaBold, color: rgb(0.541, 0.502, 0.439),
    });
    curY -= 8;

    const rules: [string, string][] = [
      ["Retrait voie", `${ai.retraitVoie} m minimum`],
      ["Retrait lateral", `${ai.retraitLateral} m minimum`],
      ["Retrait fond", `${ai.retraitFond} m minimum`],
      ["Emprise au sol max", ai.empriseNonReglementee ? "Non reglementee" : `${ai.empriseMax}%`],
      ["Hauteur maximale", `${ai.hauteurMax} m`],
      ...(ai.parkingNombrePlaces > 0
        ? [["Stationnement", `${ai.parkingNombrePlaces} place(s) requise(s)`] as [string, string]]
        : []),
    ];

    for (let i = 0; i < rules.length; i++) {
      const [label, val] = rules[i];
      const bg = i % 2 === 0 ? rgb(0.961, 0.941, 0.902) : C_WHITE;
      page.drawRectangle({ x: marginL, y: curY - 14, width: width - 80, height: 16, color: bg, borderWidth: 0 });
      page.drawText(label, { x: marginL + 8, y: curY - 10, size: 8, font: helvetica, color: rgb(0.541, 0.502, 0.439) });
      page.drawText(sanitizeText(val), { x: marginL + 200, y: curY - 10, size: 8, font: helveticaBold, color: rgb(0.133, 0.118, 0.094) });
      curY -= 16;
    }
  }

  // ── Bilan surfaces ──
  curY -= 16;
  page.drawText("BILAN DES SURFACES", {
    x: marginL, y: curY, size: 8, font: helveticaBold, color: rgb(0.541, 0.502, 0.439),
  });
  curY -= 8;

  const surfaceRows: [string, string][] = [
    ...(data.existingM2 > 0 ? [["Surface existante", `${data.existingM2} m2`] as [string, string]] : []),
    ["Surface projet", `${data.drawnM2} m2`],
    ["Surface totale", `${data.totalM2} m2`],
    ["Emprise au sol", `${data.empriseP}%`],
  ];

  for (let i = 0; i < surfaceRows.length; i++) {
    const [label, val] = surfaceRows[i];
    const bg = i % 2 === 0 ? rgb(0.961, 0.941, 0.902) : C_WHITE;
    const isBold = label === "Surface totale" || label === "Emprise au sol";
    page.drawRectangle({ x: marginL, y: curY - 14, width: width - 80, height: 16, color: bg, borderWidth: 0 });
    page.drawText(label, { x: marginL + 8, y: curY - 10, size: 8, font: isBold ? helveticaBold : helvetica, color: rgb(0.541, 0.502, 0.439) });
    page.drawText(val, { x: marginL + 200, y: curY - 10, size: 8, font: isBold ? helveticaBold : helvetica, color: rgb(0.133, 0.118, 0.094) });
    curY -= 16;
  }

  // ── Formes desinees ──
  if (data.drawnShapes.length > 0) {
    curY -= 16;
    page.drawText("ELEMENTS DU PROJET", {
      x: marginL, y: curY, size: 8, font: helveticaBold, color: rgb(0.541, 0.502, 0.439),
    });
    curY -= 8;

    for (let i = 0; i < data.drawnShapes.length; i++) {
      const sh = data.drawnShapes[i];
      const bg = i % 2 === 0 ? rgb(0.961, 0.941, 0.902) : C_WHITE;
      const label = sh.niveaux
        ? `${sanitizeText(sh.label)} (${sh.niveaux.toUpperCase()})`
        : sanitizeText(sh.label);
      page.drawRectangle({ x: marginL, y: curY - 14, width: width - 80, height: 16, color: bg, borderWidth: 0 });
      page.drawText(label, { x: marginL + 8, y: curY - 10, size: 8, font: helvetica, color: rgb(0.541, 0.502, 0.439) });
      page.drawText(`${sh.surfaceM2} m2`, { x: marginL + 200, y: curY - 10, size: 8, font: helveticaBold, color: rgb(0.133, 0.118, 0.094) });
      curY -= 16;
    }
  }

  // ── Resume IA ──
  if (data.aiAnalysis?.resume) {
    curY -= 16;
    const resumeLabel = "SYNTHESE IA";
    page.drawText(resumeLabel, {
      x: marginL, y: curY, size: 8, font: helveticaBold, color: rgb(0.541, 0.502, 0.439),
    });
    curY -= 12;

    // Wrap simple du texte (60 chars par ligne max)
    const resumeText = sanitizeText(data.aiAnalysis.resume);
    const words = resumeText.split(" ");
    const lines: string[] = [];
    let line = "";
    const maxLineWidth = width - 80;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (helvetica.widthOfTextAtSize(test, 8) > maxLineWidth) {
        if (line) lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);

    const maxLines = Math.min(lines.length, 6);
    for (let li = 0; li < maxLines; li++) {
      if (curY < 80) break;
      page.drawText(lines[li], { x: marginL, y: curY, size: 8, font: helvetica, color: rgb(0.133, 0.118, 0.094) });
      curY -= 12;
    }
  }

  // ── Footer / disclaimer ──
  const footerY = 40;
  page.drawLine({ start: { x: marginL, y: footerY + 18 }, end: { x: width - marginL, y: footerY + 18 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  page.drawText("Metaconception — Dessinateur-Concepteur en Architecture — Junas, 30250 Gard — contact@metaconception.eu", {
    x: marginL, y: footerY + 6, size: 6.5, font: helvetica, color: C_GRIS,
  });
  page.drawText(
    "Ce rapport est genere automatiquement a titre indicatif uniquement. Il ne constitue pas un avis juridique ni une garantie administrative.",
    { x: marginL, y: footerY - 6, size: 6, font: helvetica, color: rgb(0.6, 0.6, 0.6) },
  );
  page.drawText("Consultez un professionnel qualifie avant tout depot de dossier. Donnees traitees conformement au RGPD.", {
    x: marginL, y: footerY - 16, size: 6, font: helvetica, color: rgb(0.6, 0.6, 0.6),
  });
  page.drawText("3 / 3", { x: width - 50, y: 15, size: 7, font: helvetica, color: C_GRIS });
}

// ── Export principal ──────────────────────────────────────────────────────────

export async function generatePluPdf(data: PdfReportData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();

  // Metadonnees
  pdfDoc.setTitle(`Analyse PLU - ${data.adresseProjet}`);
  pdfDoc.setAuthor("Metaconception");
  pdfDoc.setCreationDate(new Date());

  // Fonts
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Logo (public/logo-pdf.png — optionnel, silencieux si absent)
  let logoImage: PDFImage | null = null;
  try {
    const logoBuf = await readFile(join(process.cwd(), "public", "logo-pdf.png"));
    logoImage = await pdfDoc.embedPng(logoBuf);
  } catch {
    // Pas de logo : on continue sans
  }

  // Fond de carte OSM — téléchargé une seule fois, partagé pages 1 et 2
  let mapImage: PDFImage | null = null;
  if (data.parcelRing && data.parcelRing.length >= 3) {
    try {
      const mapBuf = await fetchMapBackground(data.parcelRing, 515, 660);
      if (mapBuf) mapImage = await pdfDoc.embedPng(mapBuf);
    } catch { /* pas de fond */ }
  }

  // 3 pages
  await drawPage1(pdfDoc, data, helvetica, helveticaBold, logoImage, mapImage);
  await drawPage2(pdfDoc, data, helvetica, helveticaBold, logoImage, mapImage);
  await drawPage3(pdfDoc, data, helvetica, helveticaBold, logoImage);

  return pdfDoc.save();
}
