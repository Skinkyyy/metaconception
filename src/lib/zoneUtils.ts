// Utilitaires géométriques pour les zones constructibles PLU
// Extraits depuis MapPicker.tsx — utilisés aussi dans plu-pdf.ts (serveur)

export function _kLon(avgLat: number): number {
  return 111320 * Math.cos((avgLat * Math.PI) / 180);
}

/** Segment intersection test in 2-D. Returns intersection point or null. */
export function seg2dIntersect(
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

/**
 * Remove self-intersecting loops ("knots") from a polygon.
 * When the offset polygon has a narrow corridor section (width < 2*rl), the
 * vertex-intersection algorithm produces a self-intersecting "tongue". This
 * function finds crossing segments, clips the inner loop to the crossing point,
 * and recurses until no crossings remain.
 */
export function removeKnots(pts: [number, number][]): [number, number][] {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent edges in closed ring
      const c = pts[j], d = pts[(j + 1) % n];
      const ix = seg2dIntersect(a, b, c, d);
      if (ix) {
        // Replace vertices i+1 … j with the single crossing point
        const next = [...pts.slice(0, i + 1), ix, ...pts.slice(j + 1)];
        if (next.length < 3) return pts;
        return removeKnots(next);
      }
    }
  }
  return pts;
}

/** Inward polygon offset by vertex intersection, with knot removal for narrow corridors. */
export function computeOffsetPoly(
  ring: [number, number][],
  setbacks: number[],
): [number, number][] | null {
  const n = ring.length - 1;
  if (n < 3 || setbacks.length !== n) return null;
  const kLat = 111320;
  const avgLat = ring.reduce((s, [, lat]) => s + lat, 0) / n;
  const kLon = _kLon(avgLat);

  const pts: [number, number][] = Array.from({ length: n }, (_, i) => [ring[i][0] * kLon, ring[i][1] * kLat]);

  // Winding order
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n];
    area += x1 * y2 - x2 * y1;
  }
  const ccw = area > 0;

  // Inward unit normal for each edge
  const normals: [number, number][] = Array.from({ length: n }, (_, i) => {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n];
    const dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.01) return [0, 0];
    return ccw ? [-dy / len, dx / len] : [dy / len, -dx / len];
  });

  // For each vertex: intersect the two adjacent offset lines
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

  // Remove self-intersecting loops caused by corridors narrower than 2*setback
  const result = removeKnots(raw);
  if (result.length < 3) return null;
  return result.map(([x, y]) => [y / kLat, x / kLon] as [number, number]);
}

/** Classify each parcel edge: retrait voie / lateral / fond based on access direction. */
export function classifyEdgeSetbacks(
  ring: [number, number][],
  access: { lat: number; lon: number } | null,
  rv: number, rl: number, rf: number,
): number[] {
  const n = ring.length - 1;
  if (!access) return Array(n).fill(rl);
  const kLat = 111320;
  const avgLat = ring.reduce((s, [, lat]) => s + lat, 0) / n;
  const kLon = _kLon(avgLat);
  const cx = ring.reduce((s, [lon]) => s + lon * kLon, 0) / n;
  const cy = ring.reduce((s, [, lat]) => s + lat * kLat, 0) / n;
  const ax = access.lon * kLon - cx, ay = access.lat * kLat - cy;
  const aLen = Math.sqrt(ax * ax + ay * ay);
  if (aLen < 0.01) return Array(n).fill(rl);
  const anx = ax / aLen, any = ay / aLen;

  return Array.from({ length: n }, (_, i) => {
    const [lon1, lat1] = ring[i], [lon2, lat2] = ring[(i + 1) % n];
    const x1 = lon1 * kLon, y1 = lat1 * kLat, x2 = lon2 * kLon, y2 = lat2 * kLat;
    const dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.01) return rl;
    let nx = -dy / len, ny = dx / len;
    const midx = (x1 + x2) / 2, midy = (y1 + y2) / 2;
    if (nx * (cx - midx) + ny * (cy - midy) > 0) { nx = -nx; ny = -ny; }
    const dot = nx * anx + ny * any;
    return dot > 0.5 ? rv : dot < -0.5 ? rf : rl;
  });
}
