"use client";

import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import Map from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import OSM from "ol/source/OSM";
import XYZ from "ol/source/XYZ";
import { fromLonLat, toLonLat } from "ol/proj";
import OLGeoJSON from "ol/format/GeoJSON";
import Feature from "ol/Feature";
import { Polygon as OLPolygon, LineString as OLLineString, Point as OLPoint } from "ol/geom";
import { Style, Fill, Stroke, Text as OLText, Circle as CircleStyle } from "ol/style";
import Overlay from "ol/Overlay";
import Collection from "ol/Collection";
import Modify from "ol/interaction/Modify";
import Translate from "ol/interaction/Translate";
import type { Coordinate } from "ol/coordinate";
import "ol/ol.css";

import type { PluRules, SnapConfig } from "@/lib/geo";
import {
  computeSnap, buildCoteLines, areaM2, fmtDist,
  computeOffsetPoly, nearestEdgeDir, buildRotatedRect,
  K_LAT, kLon, DEFAULT_SNAP_CONFIG, removeNarrowCorridors,
  classifyEdgeSetbacks,
} from "@/lib/geo";
import type { DrawnShape, ParcelInfo, ZoneMode, Building } from "./PlanEditor";
import { SHAPE_TYPE_CONFIG } from "./shapeConstants";
import type { ShapeType } from "./shapeConstants";

// ── Helpers coord ─────────────────────────────────────────────────────────────

function ll2ol(lat: number, lon: number): Coordinate {
  return fromLonLat([lon, lat]);
}

function ol2ll(c: Coordinate): [number, number] {
  const [lon, lat] = toLonLat(c);
  return [lat, lon];
}

function llArr2ol(pts: [number, number][]): Coordinate[] {
  return pts.map(([lat, lon]) => ll2ol(lat, lon));
}

// Convertir anneau GeoJSON [lon, lat][] → OL coordinates
function geoRing2ol(ring: [number, number][]): Coordinate[] {
  return ring.map(([lon, lat]) => ll2ol(lat, lon));
}

// Distance en mètres entre deux points lat/lon (approximation plane, valide < quelques km)
function distM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dlat = (lat2 - lat1) * K_LAT;
  const dlon = (lon2 - lon1) * kLon((lat1 + lat2) / 2);
  return Math.sqrt(dlat * dlat + dlon * dlon);
}

// Projeter un point à distance exacte dans une direction normalisée (espace métrique)
function projectAtDist(
  lat: number, lon: number,
  dir: [number, number], // [dlat_norm_m, dlon_norm_m]
  dist: number,
): [number, number] {
  return [
    lat + (dir[0] * dist) / K_LAT,
    lon + (dir[1] * dist) / kLon(lat),
  ];
}

// ── Styles ────────────────────────────────────────────────────────────────────

const parcelDefaultStyle = new Style({
  fill: new Fill({ color: "rgba(196,163,90,0.04)" }),
  stroke: new Stroke({ color: "#c4a35a", width: 1.5 }),
});

const parcelHoverStyle = new Style({
  fill: new Fill({ color: "rgba(196,163,90,0.14)" }),
  stroke: new Stroke({ color: "#d4b870", width: 2.5 }),
});

const parcelSelectedStyle = new Style({
  fill: new Fill({ color: "rgba(196,163,90,0.10)" }),
  stroke: new Stroke({ color: "#c4a35a", width: 2.5, lineDash: [6, 3] }),
});

function shapeStyle(color: string, selected = false) {
  return new Style({
    fill: new Fill({ color: color + "33" }),
    stroke: new Stroke({ color, width: selected ? 2.5 : 2, lineDash: selected ? undefined : [6, 3] }),
  });
}

const buildingExistingStyle = new Style({
  fill: new Fill({ color: "rgba(245,158,11,0.18)" }),
  stroke: new Stroke({ color: "#f59e0b", width: 1.5 }),
});

const zoneStyle = new Style({
  fill: new Fill({ color: "rgba(45,106,79,0.15)" }),
  stroke: new Stroke({ color: "#2d6a4f", width: 2, lineDash: [6, 4] }),
});

const zoneAnnexeStyle = new Style({
  fill: new Fill({ color: "rgba(249,115,22,0.12)" }),   // orange — cohérent avec le bouton PluPanel
  stroke: new Stroke({ color: "#f97316", width: 2, lineDash: [6, 4] }),
});

const zoneRdcStyle = new Style({
  fill: new Fill({ color: "rgba(124,58,237,0.12)" }),   // violet — cohérent avec le bouton PluPanel
  stroke: new Stroke({ color: "#7c3aed", width: 2, lineDash: [6, 4] }),
});

const coteLineStyle = new Style({
  stroke: new Stroke({ color: "#c4a35a", width: 1.5, lineDash: [5, 4] }),
});

const coteLineWarnStyle = new Style({
  stroke: new Stroke({ color: "#dc2626", width: 1.5, lineDash: [5, 4] }),
});

const previewStyle = new Style({
  stroke: new Stroke({ color: "#2d6a4f", width: 2, lineDash: [8, 4] }),
});

const previewFillStyle = new Style({
  fill: new Fill({ color: "rgba(45,106,79,0.12)" }),
  stroke: new Stroke({ color: "#2d6a4f", width: 2, lineDash: [8, 4] }),
});

const snapDotStyle = new Style({
  image: new CircleStyle({
    radius: 6,
    fill: new Fill({ color: "#f59e0b" }),
    stroke: new Stroke({ color: "#fff", width: 2 }),
  }),
});

// ── Styles mesure ─────────────────────────────────────────────────────────────
import type { FeatureLike } from "ol/Feature";
function measureStyleFn(feature: FeatureLike): Style {
  const geom = feature.getGeometry();
  if (geom instanceof OLPoint) {
    return new Style({
      image: new CircleStyle({ radius: 4, fill: new Fill({ color: "#00cfff" }), stroke: new Stroke({ color: "#fff", width: 1.5 }) }),
    });
  }
  return new Style({ stroke: new Stroke({ color: "#00cfff", width: 2, lineDash: [6, 3] }) });
}

// ── WFS parcel fetch ──────────────────────────────────────────────────────────

async function fetchParcels(lat: number, lon: number): Promise<Feature[]> {
  const r = 0.003;
  const bbox = `${lat - r},${lon - r},${lat + r},${lon + r}`;
  const url = `https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle&SRSNAME=EPSG:4326&BBOX=${bbox}&OUTPUTFORMAT=application/json&COUNT=200`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    const fmt = new OLGeoJSON({ dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" });
    return fmt.readFeatures(json) as Feature[];
  } catch {
    return [];
  }
}

// Extract outer ring [lon, lat][] from GeoJSON geometry
function extractRing(geometry: { type: string; coordinates: unknown }): [number, number][] | null {
  if (geometry.type === "Polygon") {
    return ((geometry.coordinates as [number, number][][])[0]) ?? null;
  }
  if (geometry.type === "MultiPolygon") {
    return ((geometry.coordinates as [number, number][][][])[0]?.[0]) ?? null;
  }
  return null;
}

// ── Ref exposed to parent ─────────────────────────────────────────────────────

export interface MapCapture {
  dataUrl: string;
  extent: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
}

export interface MapOLRef {
  captureMap: () => Promise<MapCapture | null>;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  center: [number, number];
  zoom: number;
  tool: "select" | "draw" | "measure";
  drawSubTool: "poly" | "rect";
  drawType: ShapeType;
  onParcelSelect: (p: ParcelInfo) => void;
  selectedParcel: ParcelInfo | null;
  shapes: DrawnShape[];
  onShapeDrawn: (s: DrawnShape) => void;
  onShapeDelete: (id: string) => void;
  onShapeUpdate: (id: string, polygon: [number, number][], surfaceM2: number) => void;
  pluRules: PluRules;
  pluAnalyzed: boolean;
  zoneMode: ZoneMode;
  accessPoint: { lat: number; lon: number } | null;
  pickingAccess: boolean;
  onSetAccess: (pt: { lat: number; lon: number }) => void;
  selectedShapeId: string | null;
  onShapeSelect: (id: string | null) => void;
  editMode: "drag" | "rotate" | "vertex" | "dimensions" | null;
  existingBuildings: Building[];
  snapConfig: SnapConfig;
}

// ── Component ─────────────────────────────────────────────────────────────────

const MapOL = forwardRef<MapOLRef, Props>(function MapOL({
  center, zoom, tool, drawSubTool, drawType, onParcelSelect, selectedParcel,
  shapes, onShapeDrawn, onShapeDelete, onShapeUpdate, pluRules,
  pluAnalyzed, zoneMode,
  accessPoint, pickingAccess, onSetAccess,
  selectedShapeId, onShapeSelect, editMode,
  existingBuildings, snapConfig,
}: Props, ref) {
  const containerRef    = useRef<HTMLDivElement>(null);
  const mapRef          = useRef<Map | null>(null);
  const snapOverRef     = useRef<Overlay | null>(null);
  const snapDotRef      = useRef<HTMLDivElement | null>(null);
  const snapLabelRef    = useRef<HTMLDivElement | null>(null);
  const snapLabelOvRef  = useRef<Overlay | null>(null);

  // Layers
  const parcelsSourceRef    = useRef(new VectorSource());
  const selectedSourceRef   = useRef(new VectorSource());
  const buildingsSourceRef  = useRef(new VectorSource());
  const shapesSourceRef     = useRef(new VectorSource());
  const shapesLayerRef      = useRef<VectorLayer<VectorSource> | null>(null);
  const zoneSourceRef       = useRef(new VectorSource());
  const cotesSourceRef      = useRef(new VectorSource());
  const previewSourceRef    = useRef(new VectorSource());
  const measureSourceRef    = useRef(new VectorSource());
  const measurePtsRef       = useRef<[number, number][]>([]);
  const measureLabelOvsRef  = useRef<Overlay[]>([]);
  const snapSourceRef       = useRef(new VectorSource());
  const accessSourceRef     = useRef(new VectorSource());

  // Drawing state
  const drawingRef   = useRef(false);
  const verticesRef  = useRef<[number, number][]>([]); // [lat, lon][]
  const toolRef      = useRef(tool);
  const parcelRef    = useRef(selectedParcel);
  const shapesRef    = useRef(shapes);
  const pluRef          = useRef(pluRules);
  const pluAnalyzedRef  = useRef(pluAnalyzed);
  const zoneModeRef     = useRef(zoneMode);
  const pickingRef      = useRef(pickingAccess);
  const onSetAccessRef  = useRef(onSetAccess);
  const drawSubToolRef  = useRef(drawSubTool);
  const lastFetchRef    = useRef<string>("");
  const curDirRef        = useRef<[number, number]>([1, 0]);
  const dimInputRef      = useRef<HTMLInputElement | null>(null);
  const distLabelElRef   = useRef<HTMLDivElement | null>(null);
  const distLabelOvRef   = useRef<Overlay | null>(null);
  const selectedShapeIdRef = useRef(selectedShapeId);
  const onShapeSelectRef   = useRef(onShapeSelect);
  const onShapeUpdateRef   = useRef(onShapeUpdate);
  const editModeRef        = useRef(editMode);
  const snapConfigRef      = useRef<SnapConfig>(snapConfig);
  const drawTypeRef        = useRef<ShapeType>(drawType);
  const modifyRef          = useRef<Modify | null>(null);
  const translateRef       = useRef<Translate | null>(null);
  const isDraggingRef      = useRef(false); // true pendant un Translate actif
  const dimOverlaysRef     = useRef<Overlay[]>([]); // overlays de cotation éditable

  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { parcelRef.current = selectedParcel; }, [selectedParcel]);
  useEffect(() => { shapesRef.current = shapes; }, [shapes]);
  useEffect(() => { pluRef.current = pluRules; }, [pluRules]);
  useEffect(() => { pluAnalyzedRef.current = pluAnalyzed; }, [pluAnalyzed]);
  useEffect(() => { zoneModeRef.current = zoneMode; }, [zoneMode]);
  useEffect(() => { pickingRef.current = pickingAccess; }, [pickingAccess]);
  useEffect(() => { onSetAccessRef.current = onSetAccess; }, [onSetAccess]);
  useEffect(() => { drawSubToolRef.current = drawSubTool; }, [drawSubTool]);
  useEffect(() => { selectedShapeIdRef.current = selectedShapeId; }, [selectedShapeId]);
  useEffect(() => { onShapeSelectRef.current = onShapeSelect; }, [onShapeSelect]);
  useEffect(() => { onShapeUpdateRef.current = onShapeUpdate; }, [onShapeUpdate]);
  useEffect(() => { editModeRef.current = editMode; }, [editMode]);
  useEffect(() => { snapConfigRef.current = snapConfig; }, [snapConfig]);
  useEffect(() => { drawTypeRef.current = drawType; }, [drawType]);

  // Cote label overlays
  const coteOverlaysRef = useRef<Overlay[]>([]);

  // ── Map init ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const snapDotEl = document.createElement("div");
    snapDotEl.className = "snap-dot";
    snapDotEl.style.display = "none";
    snapDotRef.current = snapDotEl;

    const snapOverlay = new Overlay({
      element: snapDotEl,
      positioning: "center-center",
      stopEvent: false,
    });
    snapOverRef.current = snapOverlay;

    const snapLabelEl = document.createElement("div");
    snapLabelEl.className = "snap-label";
    snapLabelEl.style.display = "none";
    snapLabelRef.current = snapLabelEl;

    const snapLabelOverlay = new Overlay({
      element: snapLabelEl,
      positioning: "top-left",
      stopEvent: false,
    });
    snapLabelOvRef.current = snapLabelOverlay;

    const distLabelEl = document.createElement("div");
    distLabelEl.className = "dist-label";
    distLabelEl.style.display = "none";
    distLabelElRef.current = distLabelEl;

    const distLabelOverlay = new Overlay({
      element: distLabelEl,
      positioning: "bottom-center",
      offset: [0, -6],
      stopEvent: false,
    });
    distLabelOvRef.current = distLabelOverlay;

    const map = new Map({
      target: containerRef.current,
      layers: [
        new TileLayer({ source: new OSM({ crossOrigin: "anonymous" }), zIndex: 0 }),
        new TileLayer({
          source: new XYZ({
            url: "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=CADASTRALPARCELS.PARCELLAIRE_EXPRESS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png",
            minZoom: 15,
            maxZoom: 19,
            crossOrigin: "anonymous",
          }),
          opacity: 0.5,
          minZoom: 15,
          zIndex: 1,
        }),
        new VectorLayer({ source: parcelsSourceRef.current,   zIndex: 2, style: parcelDefaultStyle }),
        new VectorLayer({ source: selectedSourceRef.current,  zIndex: 3, style: parcelSelectedStyle }),
        new VectorLayer({ source: buildingsSourceRef.current, zIndex: 4, style: buildingExistingStyle }),
        new VectorLayer({ source: zoneSourceRef.current,      zIndex: 5, style: zoneStyle }),
        new VectorLayer({ source: cotesSourceRef.current,     zIndex: 6 }),
        (() => { const l = new VectorLayer({ source: shapesSourceRef.current, zIndex: 7 }); shapesLayerRef.current = l; return l; })(),
        new VectorLayer({ source: measureSourceRef.current,   zIndex: 8, style: measureStyleFn }),
        new VectorLayer({ source: previewSourceRef.current,   zIndex: 9 }),
        new VectorLayer({ source: snapSourceRef.current,      zIndex: 10, style: snapDotStyle }),
        new VectorLayer({ source: accessSourceRef.current,    zIndex: 11 }),
      ],
      view: new View({
        center: ll2ol(center[0], center[1]),
        zoom,
        maxZoom: 22,
      }),
      overlays: [snapOverlay, snapLabelOverlay, distLabelOverlay],
    });

    mapRef.current = map;

    // Load parcels on moveend
    const handleMoveEnd = async () => {
      const v = map.getView();
      const z = v.getZoom() ?? 0;
      if (z < 16) { parcelsSourceRef.current.clear(); return; }
      const c = ol2ll(v.getCenter()!);
      const key = `${c[0].toFixed(4)},${c[1].toFixed(4)},${Math.round(z)}`;
      if (key === lastFetchRef.current) return;
      lastFetchRef.current = key;
      const features = await fetchParcels(c[0], c[1]);
      parcelsSourceRef.current.clear();
      parcelsSourceRef.current.addFeatures(features);
    };

    map.on("moveend", handleMoveEnd);
    handleMoveEnd();

    const SNAP_LABELS: Partial<Record<string, string>> = {
      corner: "COIN", edge: "ARÊTE", perp: "PERP", "perp-seg": "⊥ SEGMENT", close: "FERMER",
    };

    // Hover parcels
    let hoveredFeature: Feature | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on("pointermove", (evt: any) => {
      if (toolRef.current === "draw") {
        const [lat, lon] = ol2ll(evt.coordinate);
        const parcel = parcelRef.current;
        // Tolérance snap : 10 pixels convertis en mètres géographiques
        const res = map.getView().getResolution() ?? 1;
        const toleranceM = Math.max(0.2, res * Math.cos((lat * Math.PI) / 180) * 10);
        const snap = computeSnap(lat, lon, parcel?.ring ?? null, shapesRef.current.map((s) => s.polygon), verticesRef.current, toleranceM, snapConfigRef.current);
        const snapDot = snapDotRef.current;
        const snapOv = snapOverRef.current;
        const snapLabel = snapLabelRef.current;
        const snapLabelOv = snapLabelOvRef.current;

        // Snap dot — visible dès le premier survol si un snap est détecté
        if (snapDot && snapOv) {
          if (snap.type !== "free") {
            snapDot.style.display = "block";
            const dotColor = snap.type === "perp-seg" ? "#3d8a65"
              : snap.type === "perp"  ? "#2d6a4f"
              : snap.type === "angle" ? "#c4a35a"
              : snap.type === "close" ? "#2d6a4f"
              : "#c4a35a";
            snapDot.style.backgroundColor = dotColor;
            snapDot.style.boxShadow = `0 0 0 2px ${dotColor}`;
            snapOv.setPosition(ll2ol(snap.lat, snap.lon));
          } else {
            snapDot.style.display = "none";
          }
        }

        // Snap label — uniquement si un snap est actif
        if (snapLabel && snapLabelOv) {
          const lbl = snap.type === "angle"
            ? `${snap.angleDeg?.toFixed(0)}°`
            : (SNAP_LABELS[snap.type] ?? "");
          if (lbl) {
            snapLabel.textContent = lbl;
            snapLabel.style.display = "block";
            snapLabelOv.setPosition(ll2ol(snap.lat, snap.lon));
          } else {
            snapLabel.style.display = "none";
          }
        }

        // Distance en temps réel depuis le dernier sommet
        const distLabel = distLabelElRef.current;
        const distLabelOv = distLabelOvRef.current;
        if (verticesRef.current.length > 0 && distLabel && distLabelOv) {
          const last = verticesRef.current[verticesRef.current.length - 1];
          const dlat_m = (snap.lat - last[0]) * K_LAT;
          const dlon_m = (snap.lon - last[1]) * kLon((last[0] + snap.lat) / 2);
          const d = Math.sqrt(dlat_m * dlat_m + dlon_m * dlon_m);
          if (d > 0.05) curDirRef.current = [dlat_m / d, dlon_m / d];
          distLabel.textContent = fmtDist(d);
          distLabel.style.display = "block";
          distLabelOv.setPosition(ll2ol((last[0] + snap.lat) / 2, (last[1] + snap.lon) / 2));
          updatePreview(snap.lat, snap.lon);
        } else {
          if (distLabel) distLabel.style.display = "none";
          if (verticesRef.current.length > 0) updatePreview(snap.lat, snap.lon);
        }
        return;
      }

      if (toolRef.current === "measure") {
        const [lat, lon] = ol2ll(evt.coordinate);
        const res = map.getView().getResolution() ?? 1;
        const toleranceM = Math.max(0.2, res * Math.cos((lat * Math.PI) / 180) * 10);
        const snap = computeSnap(lat, lon, parcelRef.current?.ring ?? null, shapesRef.current.map(s => s.polygon), measurePtsRef.current, toleranceM, snapConfigRef.current);

        const snapDotM = snapDotRef.current;
        const snapOvM  = snapOverRef.current;
        const snapLblM = snapLabelRef.current;
        const snapLblOvM = snapLabelOvRef.current;

        if (snapDotM && snapOvM) {
          if (snap.type !== "free") {
            snapDotM.style.display = "block";
            const dotColor = snap.type === "perp-seg" ? "#3d8a65" : snap.type === "perp" ? "#2d6a4f" : snap.type === "close" ? "#2d6a4f" : "#c4a35a";
            snapDotM.style.backgroundColor = dotColor;
            snapDotM.style.boxShadow = `0 0 0 2px ${dotColor}`;
            snapOvM.setPosition(ll2ol(snap.lat, snap.lon));
          } else {
            snapDotM.style.display = "none";
          }
        }
        if (snapLblM && snapLblOvM) {
          const lbl = snap.type === "angle" ? `${snap.angleDeg?.toFixed(0)}°` : (SNAP_LABELS[snap.type] ?? "");
          if (lbl) { snapLblM.textContent = lbl; snapLblM.style.display = "block"; snapLblOvM.setPosition(ll2ol(snap.lat, snap.lon)); }
          else snapLblM.style.display = "none";
        }

        const pts = measurePtsRef.current;
        const distLabelM = distLabelElRef.current;
        const distLabelOvM = distLabelOvRef.current;
        if (pts.length > 0) {
          const last = pts[pts.length - 1];
          previewSourceRef.current.clear();
          previewSourceRef.current.addFeature(new Feature(new OLLineString([ll2ol(last[0], last[1]), ll2ol(snap.lat, snap.lon)])));
          if (distLabelM && distLabelOvM) {
            const segD = distM(last[0], last[1], snap.lat, snap.lon);
            let totalPrev = 0;
            for (let i = 1; i < pts.length; i++) totalPrev += distM(pts[i-1][0], pts[i-1][1], pts[i][0], pts[i][1]);
            const txt = pts.length > 1 ? `${fmtDist(segD)}  ∑ ${fmtDist(totalPrev + segD)}` : fmtDist(segD);
            distLabelM.textContent = txt;
            distLabelM.style.display = "block";
            distLabelOvM.setPosition(ll2ol((last[0] + snap.lat) / 2, (last[1] + snap.lon) / 2));
          }
        } else {
          previewSourceRef.current.clear();
          if (distLabelM) distLabelM.style.display = "none";
        }
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hit = map.forEachFeatureAtPixel(evt.pixel, (f: any) => f as Feature, {
        layerFilter: (l: unknown) => (l as VectorLayer<VectorSource>).getSource() === parcelsSourceRef.current,
      }) as Feature | undefined;

      if (hoveredFeature && hoveredFeature !== hit) {
        hoveredFeature.setStyle(parcelDefaultStyle);
        hoveredFeature = null;
      }
      if (hit && hit !== hoveredFeature) {
        hit.setStyle(parcelHoverStyle);
        hoveredFeature = hit;
      }
      // En mode édition, curseur sur les formes
      if (editModeRef.current) {
        const hitShape = map.forEachFeatureAtPixel(evt.pixel, (f: unknown) => f as Feature, {
          layerFilter: (l: unknown) => (l as VectorLayer<VectorSource>).getSource() === shapesSourceRef.current,
          hitTolerance: 8,
        });
        map.getTargetElement().style.cursor =
          (hitShape && editModeRef.current === "drag")       ? "move"    :
          (hitShape && editModeRef.current === "dimensions") ? "pointer" :
          hit ? "pointer" : "";
      } else {
        map.getTargetElement().style.cursor = hit ? "pointer" : "";
      }
    });

    // Click parcels + drawing
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on("singleclick", (evt: any) => {
      if (pickingRef.current) {
        const [lat, lon] = ol2ll(evt.coordinate);
        onSetAccessRef.current({ lat, lon });
        return;
      }

      // Sélection / désélection d'une forme en mode select
      if (toolRef.current === "select") {
        const hitShape = map.forEachFeatureAtPixel(evt.pixel, (f: unknown) => f as Feature, {
          layerFilter: (l: unknown) => (l as VectorLayer<VectorSource>).getSource() === shapesSourceRef.current,
          hitTolerance: 8,
        }) as Feature | undefined;
        if (hitShape) {
          onShapeSelectRef.current((hitShape.getId() as string) ?? null);
          return;
        }
        // En mode édition actif, un clic hors polygone (ex: sur handle sommet) ne désélectionne pas
        if (editModeRef.current && selectedShapeIdRef.current) return;
        if (selectedShapeIdRef.current) {
          onShapeSelectRef.current(null);
          return;
        }
      }

      if (toolRef.current === "measure") {
        evt.stopPropagation?.();
        const [lat, lon] = ol2ll(evt.coordinate);
        const res = map.getView().getResolution() ?? 1;
        const toleranceM = Math.max(0.2, res * Math.cos((lat * Math.PI) / 180) * 10);
        const snap = computeSnap(lat, lon, parcelRef.current?.ring ?? null, shapesRef.current.map(s => s.polygon), measurePtsRef.current, toleranceM, snapConfigRef.current);
        const pts = measurePtsRef.current;

        if (pts.length > 0) {
          const last = pts[pts.length - 1];
          // Segment validé : trait permanent
          measureSourceRef.current.addFeature(new Feature(new OLLineString([ll2ol(last[0], last[1]), ll2ol(snap.lat, snap.lon)])));
          // Label permanent sur le segment
          const segD = distM(last[0], last[1], snap.lat, snap.lon);
          let totalPrev = 0;
          for (let i = 1; i < pts.length; i++) totalPrev += distM(pts[i-1][0], pts[i-1][1], pts[i][0], pts[i][1]);
          const txt = pts.length > 1 ? `${fmtDist(segD)}  ∑ ${fmtDist(totalPrev + segD)}` : fmtDist(segD);
          const labelEl = document.createElement("div");
          labelEl.className = "dist-label";
          labelEl.textContent = txt;
          const ov = new Overlay({ element: labelEl, positioning: "bottom-center", offset: [0, -4], stopEvent: false });
          map.addOverlay(ov);
          ov.setPosition(ll2ol((last[0] + snap.lat) / 2, (last[1] + snap.lon) / 2));
          measureLabelOvsRef.current.push(ov);
        }
        // Dot permanent au point cliqué
        measureSourceRef.current.addFeature(new Feature(new OLPoint(ll2ol(snap.lat, snap.lon))));
        pts.push([snap.lat, snap.lon]);
        return;
      }

      if (toolRef.current === "draw") {
        evt.stopPropagation?.();
        const [lat, lon] = ol2ll(evt.coordinate);
        const parcel = parcelRef.current;
        const res = map.getView().getResolution() ?? 1;
        const toleranceM = Math.max(0.2, res * Math.cos((lat * Math.PI) / 180) * 10);
        const snap = computeSnap(lat, lon, parcel?.ring ?? null, shapesRef.current.map((s) => s.polygon), verticesRef.current, toleranceM, snapConfigRef.current);
        const verts = verticesRef.current;

        if (drawSubToolRef.current === "rect") {
          if (verts.length === 0) {
            drawingRef.current = true;
            verts.push([snap.lat, snap.lon]);
          } else {
            const [aLat, aLon] = verts[0];
            const [ux, uy] = parcel ? nearestEdgeDir(aLon, aLat, parcel.ring) : [1, 0];
            const rect = buildRotatedRect(aLon, aLat, snap.lon, snap.lat, ux, uy);
            if (rect.length >= 3) { verticesRef.current = rect; finalizePolygon(); }
          }
          return;
        }

        if (verts.length >= 3 && snap.type === "close") { finalizePolygon(); return; }
        if (!drawingRef.current) drawingRef.current = true;
        verts.push([snap.lat, snap.lon]);
        updatePreview(snap.lat, snap.lon);
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hit = map.forEachFeatureAtPixel(evt.pixel, (f: any) => f as Feature, {
        layerFilter: (l: unknown) => (l as VectorLayer<VectorSource>).getSource() === parcelsSourceRef.current,
      }) as Feature | undefined;
      if (!hit) return;

      const geom = hit.getGeometry() as OLPolygon;
      const geoProps = hit.getProperties() as Record<string, unknown>;
      const fmt = new OLGeoJSON({ dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" });
      const geoJSON = JSON.parse(fmt.writeFeature(hit));
      const ring = extractRing(geoJSON.geometry);
      if (!ring) return;
      const polygon: [number, number][] = ring.map(([lo, la]: [number, number]) => [la, lo]);
      const surface = areaM2(polygon);
      const parcelInfo: ParcelInfo = {
        id: (geoProps.idu ?? geoProps.id_parcelle ?? "?") as string,
        surface, ring, polygon,
      };
      selectedSourceRef.current.clear();
      selectedSourceRef.current.addFeature(new Feature(geom.clone()));
      onParcelSelect(parcelInfo);
    });

    // Double click → finalize drawing / end measure
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on("dblclick", (evt: any) => {
      if (toolRef.current === "measure") {
        evt.preventDefault?.();
        // Supprime le dernier point ajouté par le singleclick du dblclick
        if (measurePtsRef.current.length > 0) measurePtsRef.current.pop();
        cancelMeasure();
        return;
      }
      if (toolRef.current !== "draw") return;
      if (verticesRef.current.length < 3) return;
      evt.preventDefault?.();
      finalizePolygon();
    });

    // Right click → cancel drawing / cancel measure
    containerRef.current.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (toolRef.current === "draw") cancelDrawing();
      if (toolRef.current === "measure") cancelMeasure();
    });

    return () => {
      map.dispose();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Preview update ──────────────────────────────────────────────────────────
  const updatePreview = useCallback((curLat: number, curLon: number) => {
    const verts = verticesRef.current;
    previewSourceRef.current.clear();
    if (verts.length === 0) return;

    const coords = [...llArr2ol(verts), ll2ol(curLat, curLon)];

    if (coords.length >= 3) {
      // Show filled polygon preview
      const closedCoords = [...coords, coords[0]];
      previewSourceRef.current.addFeature(
        new Feature(new OLPolygon([closedCoords])),
      );
    } else {
      // Show line
      previewSourceRef.current.addFeature(
        new Feature(new OLLineString(coords)),
      );
    }
  }, []);

  // ── Finalize polygon ────────────────────────────────────────────────────────
  const finalizePolygon = useCallback(() => {
    const verts = verticesRef.current;
    if (verts.length < 3) return;

    const surface = areaM2(verts);
    const id = `shape-${Date.now()}`;
    const type = drawTypeRef.current;
    const cfg = SHAPE_TYPE_CONFIG[type];

    const shape: DrawnShape = {
      id,
      type,
      polygon: [...verts],
      surfaceM2: surface,
      label: cfg.label,
      hauteurBase: cfg.hauteurBaseDefaut,
      hauteurFaitage: cfg.hauteurFaitageDefaut,
    };

    onShapeDrawn(shape);

    // Reset drawing
    verticesRef.current = [];
    drawingRef.current = false;
    previewSourceRef.current.clear();

    if (snapDotRef.current) snapDotRef.current.style.display = "none";
    if (distLabelElRef.current) distLabelElRef.current.style.display = "none";
    if (dimInputRef.current) { dimInputRef.current.value = ""; dimInputRef.current.blur(); }
  }, [onShapeDrawn]);

  // ── Mesure — annulation / réinitialisation ────────────────────────────────
  const cancelMeasure = useCallback(() => {
    measurePtsRef.current = [];
    measureSourceRef.current.clear();
    for (const ov of measureLabelOvsRef.current) mapRef.current?.removeOverlay(ov);
    measureLabelOvsRef.current = [];
    previewSourceRef.current.clear();
    if (distLabelElRef.current)  distLabelElRef.current.style.display  = "none";
    if (snapDotRef.current)      snapDotRef.current.style.display      = "none";
    if (snapLabelRef.current)    snapLabelRef.current.style.display    = "none";
  }, []);

  // ── Cancel drawing ──────────────────────────────────────────────────────────
  const cancelDrawing = useCallback(() => {
    verticesRef.current = [];
    drawingRef.current = false;
    previewSourceRef.current.clear();
    if (snapDotRef.current) snapDotRef.current.style.display = "none";
    if (distLabelElRef.current) distLabelElRef.current.style.display = "none";
    if (dimInputRef.current) { dimInputRef.current.value = ""; dimInputRef.current.blur(); }
  }, []);

  // ── Reset drawing/measure on tool change ────────────────────────────────────
  useEffect(() => {
    if (tool !== "draw") {
      cancelDrawing();
      if (snapDotRef.current) snapDotRef.current.style.display = "none";
      if (snapLabelRef.current) snapLabelRef.current.style.display = "none";
      if (distLabelElRef.current) distLabelElRef.current.style.display = "none";
    }
    if (tool !== "measure") cancelMeasure();
    if (mapRef.current) {
      const cursor = (tool === "draw" || tool === "measure") ? "crosshair" : editMode === "drag" ? "move" : "";
      mapRef.current.getTargetElement().style.cursor = cursor;
    }
  }, [tool, editMode, cancelDrawing, cancelMeasure]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (toolRef.current === "measure") {
        if (e.key === "Escape") { e.preventDefault(); cancelMeasure(); }
        return;
      }
      if (toolRef.current !== "draw") return;

      const dimInput = dimInputRef.current;
      const inputFocused = document.activeElement === dimInput;

      if (inputFocused) {
        if (e.key === "Enter") {
          e.preventDefault();
          const val = parseFloat(dimInput?.value ?? "");
          if (val > 0 && verticesRef.current.length > 0) {
            const last = verticesRef.current[verticesRef.current.length - 1];
            const [newLat, newLon] = projectAtDist(last[0], last[1], curDirRef.current, val);
            verticesRef.current.push([newLat, newLon]);
            updatePreview(newLat, newLon);
            if (dimInput) { dimInput.value = ""; dimInput.blur(); }
            return;
          }
          if (verticesRef.current.length >= 3) finalizePolygon();
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          if (dimInput) { dimInput.value = ""; dimInput.blur(); }
          return;
        }
        return; // laisser l'input gérer les autres touches
      }

      // Input non focalisé
      if (e.key === "Escape") { cancelDrawing(); return; }
      if (e.key === "Enter" && verticesRef.current.length >= 3) { finalizePolygon(); return; }
      if (e.key === "Backspace") {
        e.preventDefault();
        if (verticesRef.current.length > 0) {
          verticesRef.current.pop();
          const verts = verticesRef.current;
          if (verts.length > 0) {
            const last = verts[verts.length - 1];
            updatePreview(last[0], last[1]);
          } else {
            previewSourceRef.current.clear();
            drawingRef.current = false;
          }
        }
        return;
      }
      // Touche numérique → activer la saisie de cote
      if (verticesRef.current.length > 0 && (/^\d$/.test(e.key) || e.key === ".")) {
        e.preventDefault();
        if (dimInput) { dimInput.value = e.key; dimInput.focus(); }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [cancelDrawing, cancelMeasure, finalizePolygon, updatePreview]);

  // ── Translate (déplacement) ─────────────────────────────────────────────────
  // Utilise le layer ref — OL résout les features dynamiquement, sans Collection stale
  useEffect(() => {
    const map = mapRef.current;
    if (translateRef.current) { map?.removeInteraction(translateRef.current); translateRef.current = null; }
    if (!map || editMode !== "drag" || !shapesLayerRef.current) return;

    const translate = new Translate({ layers: [shapesLayerRef.current] });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    translate.on("translatestart", (evt: any) => {
      isDraggingRef.current = true;
      const f: Feature | undefined = evt.features?.getArray()[0];
      if (f) onShapeSelectRef.current((f.getId() as string) ?? null);
    });

    // Mise à jour en temps réel pendant le drag → recalcul conformité immédiat
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    translate.on("translating", (evt: any) => {
      const f: Feature | undefined = evt.features?.getArray()[0];
      if (!f) return;
      const id = f.getId() as string;
      const coords = (f.getGeometry() as OLPolygon).getCoordinates()[0];
      const poly = coords.slice(0, -1).map((c) => ol2ll(c) as [number, number]);
      onShapeUpdateRef.current(id, poly, areaM2(poly));
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    translate.on("translateend", (evt: any) => {
      isDraggingRef.current = false;
      const f: Feature | undefined = evt.features?.getArray()[0];
      if (!f) return;
      const id = f.getId() as string;
      const coords = (f.getGeometry() as OLPolygon).getCoordinates()[0];
      const poly = coords.slice(0, -1).map((c) => ol2ll(c) as [number, number]);
      onShapeUpdateRef.current(id, poly, areaM2(poly));
    });

    map.addInteraction(translate);
    translateRef.current = translate;
    return () => { map.removeInteraction(translate); translateRef.current = null; };
  }, [editMode]);

  // ── Modify (édition des sommets) ─────────────────────────────────────────────
  // Utilise la source directement — les handles apparaissent sur toutes les surfaces
  useEffect(() => {
    const map = mapRef.current;
    if (modifyRef.current) { map?.removeInteraction(modifyRef.current); modifyRef.current = null; }
    if (!map || editMode !== "vertex") return;

    const modify = new Modify({ source: shapesSourceRef.current });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    modify.on("modifyend", (evt: any) => {
      const features: Feature[] = evt.features?.getArray() ?? [];
      for (const feat of features) {
        const id = feat.getId() as string;
        if (!id) continue;
        const coords = (feat.getGeometry() as OLPolygon).getCoordinates()[0];
        const poly = coords.slice(0, -1).map((c) => ol2ll(c) as [number, number]);
        onShapeUpdateRef.current(id, poly, areaM2(poly));
      }
    });
    map.addInteraction(modify);
    modifyRef.current = modify;
    return () => { map.removeInteraction(modify); modifyRef.current = null; };
  }, [editMode]);

  // ── Update shapes layer ─────────────────────────────────────────────────────
  // Mise à jour en place (pas de clear/re-add) pour éviter la race condition
  // pendant un drag Translate ou une édition Modify (les Feature OL doivent
  // rester les mêmes objets — les interactions maintiennent des références internes).
  useEffect(() => {
    // Remove old cote overlays
    coteOverlaysRef.current.forEach((ov) => mapRef.current?.removeOverlay(ov));
    coteOverlaysRef.current = [];
    cotesSourceRef.current.clear();

    const parcel = parcelRef.current;
    const source = shapesSourceRef.current;

    // Supprimer les features des shapes supprimées
    const newIds = new Set(shapes.map((s) => s.id));
    source.getFeatures().filter((f) => !newIds.has(f.getId() as string))
      .forEach((f) => source.removeFeature(f));

    for (const shape of shapes) {
      const coords = llArr2ol(shape.polygon);
      const closedCoords = [...coords, coords[0]];
      const isSelected = shape.id === selectedShapeId;
      const featureStyle = shapeStyle(SHAPE_TYPE_CONFIG[shape.type].color, isSelected);

      const existing = source.getFeatureById(shape.id) as Feature | null;
      if (existing) {
        // Ne pas écraser la géométrie pendant un Translate actif — OL la gère lui-même
        if (!isDraggingRef.current) {
          (existing.getGeometry() as OLPolygon).setCoordinates([closedCoords]);
        }
        existing.setStyle(featureStyle);
      } else {
        const feat = new Feature(new OLPolygon([closedCoords]));
        feat.setStyle(featureStyle);
        feat.setId(shape.id);
        source.addFeature(feat);
      }

      // Cotations — toutes les formes (les règles PLU s'appliquent au cas par cas)
      if (parcel) {
        const cotes = buildCoteLines(shape.polygon, parcel.ring);
        for (const cote of cotes) {
          const warn = cote.dist < pluRules.retraitLateral;

          const lineFeat = new Feature(
            new OLLineString([ll2ol(cote.from[0], cote.from[1]), ll2ol(cote.to[0], cote.to[1])]),
          );
          lineFeat.setStyle(warn ? coteLineWarnStyle : coteLineStyle);
          cotesSourceRef.current.addFeature(lineFeat);

          const el = document.createElement("div");
          el.className = `cote-label${warn ? " warning" : ""}`;
          el.textContent = fmtDist(cote.dist);

          const overlay = new Overlay({
            element: el,
            positioning: "center-center",
            position: ll2ol(cote.mid[0], cote.mid[1]),
            stopEvent: false,
          });
          mapRef.current?.addOverlay(overlay);
          coteOverlaysRef.current.push(overlay);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapes, pluRules, selectedShapeId]);

  // ── Cotations éditables (mode "dimensions") ────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    dimOverlaysRef.current.forEach(ov => map?.removeOverlay(ov));
    dimOverlaysRef.current = [];

    if (editMode !== "dimensions" || !selectedShapeId || !map) return;

    const shape = shapes.find(s => s.id === selectedShapeId);
    if (!shape) return;

    const poly = shape.polygon; // [lat, lon][]
    const n = poly.length;

    // Centroïde de la surface en coordonnées métriques (pour calculer la direction "vers l'intérieur")
    const avgLat = poly.reduce((s, [lat]) => s + lat, 0) / n;
    const kl     = kLon(avgLat);
    const ctX    = poly.reduce((s, [, lon]) => s + lon * kl, 0) / n;
    const ctY    = poly.reduce((s, [lat])  => s + lat * K_LAT, 0) / n;

    // Déplace un vertex le long de la direction de l'arête
    const applyChange = (edgeIdx: number, newLen: number, mode: "left" | "right" | "both") => {
      const i = edgeIdx;
      const j = (i + 1) % n;

      const ax = poly[i][1] * kl,  ay = poly[i][0] * K_LAT;
      const bx = poly[j][1] * kl,  by = poly[j][0] * K_LAT;
      const dx = bx - ax, dy = by - ay;
      const curLen = Math.sqrt(dx * dx + dy * dy);
      if (curLen < 0.01) return;

      const edx = dx / curLen, edy = dy / curLen;
      const delta = newLen - curLen;
      const newPoly: [number, number][] = poly.map(p => [...p] as [number, number]);

      if (mode === "left" || mode === "both") {
        const r = mode === "both" ? 0.5 : 1;
        newPoly[i] = [(ay - edy * delta * r) / K_LAT, (ax - edx * delta * r) / kl];
      }
      if (mode === "right" || mode === "both") {
        const r = mode === "both" ? 0.5 : 1;
        newPoly[j] = [(by + edy * delta * r) / K_LAT, (bx + edx * delta * r) / kl];
      }

      onShapeUpdateRef.current(shape.id, newPoly, areaM2(newPoly));
    };

    for (let i = 0; i < n; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];

      // Arête en espace métrique
      const ax = a[1] * kl, ay = a[0] * K_LAT;
      const bx = b[1] * kl, by = b[0] * K_LAT;
      const edgeDX = bx - ax, edgeDY = by - ay;  // (est, nord)
      const edgeLen = Math.sqrt(edgeDX * edgeDX + edgeDY * edgeDY);
      if (edgeLen < 0.05) continue;

      // Milieu de l'arête
      const mx = (ax + bx) / 2, my = (ay + by) / 2;

      // Direction vers l'intérieur (milieu → centroïde), normalisée
      const inDX = ctX - mx, inDY = ctY - my;
      const inLen = Math.sqrt(inDX * inDX + inDY * inDY);
      if (inLen < 0.01) continue;
      const nInX = inDX / inLen, nInY = inDY / inLen; // (est, nord) normalisé

      const INWARD_M = 0.44;
      const posLat = (my + nInY * INWARD_M) / K_LAT;
      const posLon = (mx + nInX * INWARD_M) / kl;

      // Angle CSS parallèle à l'arête (est=0°, sens horaire sur écran, y inversé)
      // atan2(-edgeDY, edgeDX) car l'axe y écran pointe vers le bas
      let angleDeg = Math.atan2(-edgeDY, edgeDX) * 180 / Math.PI;
      // Normaliser pour que le texte soit toujours lisible (jamais à l'envers)
      if (angleDeg >  90) angleDeg -= 180;
      if (angleDeg < -90) angleDeg += 180;

      // ── Éléments DOM ──────────────────────────────────────────────────────
      const el = document.createElement("div");
      el.className = "dim-overlay";
      el.style.transform = `rotate(${angleDeg.toFixed(1)}deg)`;

      const btnLeft  = document.createElement("button");
      btnLeft.className   = "dim-arrow";
      btnLeft.textContent = "◀";

      const spanVal = document.createElement("span");
      spanVal.className   = "dim-value";
      spanVal.textContent = fmtDist(edgeLen);

      const btnRight = document.createElement("button");
      btnRight.className   = "dim-arrow";
      btnRight.textContent = "▶";

      el.appendChild(btnLeft);
      el.appendChild(spanVal);
      el.appendChild(btnRight);

      const openEdit = (mode: "left" | "right" | "both") => {
        const icon  = mode === "left" ? "◀" : mode === "right" ? "▶" : "↔";
        const input = document.createElement("input");
        input.type      = "number";
        input.min       = "0.01";
        input.step      = "0.01";
        input.value     = edgeLen.toFixed(2);
        input.className = "dim-input";

        const iconEl = document.createElement("span");
        iconEl.className   = "dim-mode-icon";
        iconEl.textContent = icon;

        const unitEl = document.createElement("span");
        unitEl.className   = "dim-unit";
        unitEl.textContent = "m";

        el.innerHTML = "";
        el.appendChild(iconEl);
        el.appendChild(input);
        el.appendChild(unitEl);
        input.focus();
        input.select();

        const restore = () => {
          el.innerHTML = "";
          el.appendChild(btnLeft);
          el.appendChild(spanVal);
          el.appendChild(btnRight);
        };

        let committed = false;
        input.addEventListener("keydown", (e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            const v = parseFloat(input.value);
            if (v >= 0.01) { committed = true; applyChange(i, v, mode); }
          } else if (e.key === "Escape") {
            restore();
          }
        });
        input.addEventListener("blur",      () => { if (!committed) restore(); });
        input.addEventListener("click",     (e) => e.stopPropagation());
        input.addEventListener("mousedown", (e) => e.stopPropagation());
      };

      btnLeft.addEventListener("click",  (e) => { e.stopPropagation(); openEdit("left"); });
      spanVal.addEventListener("click",  (e) => { e.stopPropagation(); openEdit("both"); });
      btnRight.addEventListener("click", (e) => { e.stopPropagation(); openEdit("right"); });

      const overlay = new Overlay({
        element: el,
        positioning: "center-center",
        position: ll2ol(posLat, posLon),
        stopEvent: true,
      });

      map.addOverlay(overlay);
      dimOverlaysRef.current.push(overlay);
    }

    return () => {
      dimOverlaysRef.current.forEach(ov => map?.removeOverlay(ov));
      dimOverlaysRef.current = [];
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, selectedShapeId, shapes]);

  // ── Update zone constructible ───────────────────────────────────────────────
  useEffect(() => {
    zoneSourceRef.current.clear();
    if (!selectedParcel || !pluAnalyzed) return;

    const n  = selectedParcel.ring.length - 1;
    const rl = pluRules.retraitLateral;
    const rv = pluRules.retraitVoirie;
    const rf = pluRules.retraitFond;
    // Pour annexe/rdc : utiliser le retrait voirie spécifique si l'IA l'a extrait, sinon le principal
    const rvAnnexe = pluRules.retraitVoirieAnnexe > 0 ? pluRules.retraitVoirieAnnexe : rv;

    if (zoneMode === "standard") {
      const setbacks = accessPoint
        ? classifyEdgeSetbacks(selectedParcel.ring, accessPoint, rv, rl, rf)
        : Array(n).fill(rl);
      const mainZonePts = computeOffsetPoly(selectedParcel.ring, setbacks);
      if (!mainZonePts) return;
      const coords = llArr2ol(mainZonePts);
      const feat = new Feature(new OLPolygon([[...coords, coords[0]]]));
      feat.setStyle(zoneStyle);
      zoneSourceRef.current.addFeature(feat);
    } else {
      // Annexe / RDC en limite : retrait 0 sur latéraux et fond, rvAnnexe côté voirie
      // Morphological opening (érode+dilate 2m) pour supprimer les couloirs < 4 m
      const style = zoneMode === "annexe" ? zoneAnnexeStyle : zoneRdcStyle;
      const sbAnnex = accessPoint
        ? classifyEdgeSetbacks(selectedParcel.ring, accessPoint, rvAnnexe, 0, 0)
        : Array(n).fill(0);

      const rawAnnexPts = computeOffsetPoly(selectedParcel.ring, sbAnnex);
      if (!rawAnnexPts) return;
      const annexZonePts = removeNarrowCorridors(rawAnnexPts, 4);

      const outerCoords = llArr2ol(annexZonePts);
      const feat = new Feature(new OLPolygon([[...outerCoords, outerCoords[0]]]));
      feat.setStyle(style);
      zoneSourceRef.current.addFeature(feat);
    }
  }, [selectedParcel, pluRules.retraitLateral, pluRules.retraitVoirie, pluRules.retraitFond, pluRules.retraitVoirieAnnexe, pluAnalyzed, zoneMode, accessPoint]);

  // ── Accès voirie : marqueur + mise en surbrillance du côté voirie ──────────
  useEffect(() => {
    accessSourceRef.current.clear();
    if (!accessPoint || !selectedParcel) return;

    // Identifier les arêtes voirie avec des valeurs sentinelles
    const setbacks = classifyEdgeSetbacks(selectedParcel.ring, accessPoint, 1, 0, -1);
    const ring = selectedParcel.ring; // [lon, lat][]
    const n = ring.length - 1;

    // Mettre en surbrillance les arêtes côté voirie
    for (let i = 0; i < n; i++) {
      if (setbacks[i] === 1) {
        const [lon1, lat1] = ring[i];
        const [lon2, lat2] = ring[(i + 1) % n];
        const edgeFeat = new Feature(
          new OLLineString([ll2ol(lat1, lon1), ll2ol(lat2, lon2)]),
        );
        edgeFeat.setStyle(new Style({
          stroke: new Stroke({ color: "#f97316", width: 5 }),
        }));
        accessSourceRef.current.addFeature(edgeFeat);
      }
    }

    // Marqueur au point d'accès avec flèche et label
    const markerFeat = new Feature(new OLPoint(ll2ol(accessPoint.lat, accessPoint.lon)));
    markerFeat.setStyle(new Style({
      image: new CircleStyle({
        radius: 7,
        fill: new Fill({ color: "#f97316" }),
        stroke: new Stroke({ color: "#fff", width: 2 }),
      }),
      text: new OLText({
        text: "⬆ VOIRIE",
        offsetY: -18,
        fill: new Fill({ color: "#f97316" }),
        font: "bold 10px sans-serif",
        stroke: new Stroke({ color: "#0d1a10", width: 3 }),
      }),
    }));
    accessSourceRef.current.addFeature(markerFeat);
  }, [accessPoint, selectedParcel]);

  // ── Update existing buildings layer ────────────────────────────────────────
  useEffect(() => {
    buildingsSourceRef.current.clear();
    for (const b of existingBuildings) {
      const coords = geoRing2ol(b.ring);
      const feat = new Feature(new OLPolygon([[...coords, coords[0]]]));
      feat.setId(b.id);
      buildingsSourceRef.current.addFeature(feat);
    }
  }, [existingBuildings]);

  // ── Update selected parcel display ─────────────────────────────────────────
  useEffect(() => {
    selectedSourceRef.current.clear();
    if (!selectedParcel) return;
    const coords = geoRing2ol(selectedParcel.ring);
    const feat = new Feature(new OLPolygon([coords]));
    selectedSourceRef.current.addFeature(feat);
  }, [selectedParcel]);

  // ── Expose captureMap via ref ─────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    captureMap: () =>
      new Promise<MapCapture | null>((resolve) => {
        const map = mapRef.current;
        if (!map) { resolve(null); return; }
        map.once("rendercomplete", () => {
          try {
            const size = map.getSize() ?? [0, 0];
            const canvas = document.createElement("canvas");
            canvas.width  = size[0];
            canvas.height = size[1];
            const ctx = canvas.getContext("2d")!;
            const mapEl = map.getTargetElement() as HTMLElement;
            mapEl.querySelectorAll<HTMLCanvasElement>(".ol-layer canvas").forEach((c) => {
              if (c.width === 0) return;
              ctx.globalAlpha = parseFloat(c.style.opacity || "1") || 1;
              const transform = c.style.transform;
              if (transform && transform !== "none") {
                const m = transform.match(/matrix\(([^)]+)\)/);
                if (m) {
                  const nums = m[1].split(",").map(Number);
                  ctx.setTransform(nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]);
                }
              } else {
                ctx.setTransform(1, 0, 0, 1, 0, 0);
              }
              ctx.drawImage(c, 0, 0);
            });
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
            // Extent géographique de la vue
            const olExtent = map.getView().calculateExtent(size);
            const [x0, y0, x1, y1] = olExtent;
            const [minLon, minLat] = toLonLat([x0, y0]);
            const [maxLon, maxLat] = toLonLat([x1, y1]);
            resolve({ dataUrl, extent: [minLon, minLat, maxLon, maxLat] });
          } catch {
            resolve(null);
          }
        });
        map.renderSync();
      }),
  }), []);

  return (
    <div ref={containerRef} className="ol-map w-full h-full">
      {/* Saisie de cote */}
      {tool === "draw" && (
        <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-[#0d1a10]/95 border border-[#c4a35a]/40 rounded-lg px-3 py-1.5 shadow-lg pointer-events-none">
          <span className="text-[#5a7a5d] text-[10px] font-semibold tracking-wider">L</span>
          <input
            ref={dimInputRef}
            type="number"
            min="0.01"
            step="0.01"
            placeholder="— m"
            className="pointer-events-auto w-28 bg-transparent text-[#c4a35a] text-xs font-mono text-center outline-none placeholder-[#2a3d2e] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <span className="text-[#5a7a5d] text-[10px]">m · Tab ou chiffre</span>
        </div>
      )}

      {/* Instructions de dessin */}
      {tool === "draw" && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-[#142018]/90 text-[#a8bfaa] text-xs px-4 py-2 rounded-full border border-[#2a3d2e]/70 pointer-events-none">
          Cliquez pour placer les sommets · Clic sur le 1er point ou Entrée pour fermer · Échap pour annuler
        </div>
      )}
    </div>
  );
});

export default MapOL;
