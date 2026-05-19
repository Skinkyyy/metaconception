import { NextRequest, NextResponse } from "next/server";

export interface LotPolygon { id: string; surface: number; polygon: [number, number][] }

const WFS_BASE = "https://data.geopf.fr/wfs/ows";

async function fetchParentParcelRing(
  commune: string, section: string, numero: string
): Promise<[number, number][] | null> {
  const numPadded = numero.trim().padStart(4, "0");
  const sec = section.trim().toUpperCase().padStart(2, "0");
  const idu = `${commune.trim()}${sec}${numPadded}`;
  try {
    const qs = [
      "SERVICE=WFS", "VERSION=2.0.0", "REQUEST=GetFeature",
      "outputFormat=application%2Fjson",
      "typeName=CADASTRALPARCELS.PARCELLAIRE_EXPRESS%3Aparcelle",
      "count=1", "SRSNAME=CRS%3A84",
      `CQL_FILTER=${encodeURIComponent(`idu='${idu}'`)}`,
    ].join("&");
    const res = await fetch(`${WFS_BASE}?${qs}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.features?.length) return null;
    const geom = data.features[0].geometry;
    let ring: [number, number][] | null = null;
    if (geom.type === "Polygon") ring = geom.coordinates[0] as [number, number][];
    else if (geom.type === "MultiPolygon") ring = geom.coordinates[0][0] as [number, number][];
    if (!ring) return null;
    // IGN renvoie [lon, lat] (GeoJSON) → convertit en [lat, lon] (convention de l'app)
    return ring.map(([lon, lat]) => [lat, lon] as [number, number]);
  } catch { return null; }
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "config", message: "GEMINI_API_KEY non configurée" }, { status: 500 });
  }

  let planFile: File | null = null;
  try {
    const formData = await req.formData();
    planFile = formData.get("planLot") as File | null;
  } catch (e) {
    console.error("[plan-lot] formData error:", e);
    return NextResponse.json({ error: "request", message: "Impossible de lire la requête" }, { status: 400 });
  }

  if (!planFile) {
    return NextResponse.json({ error: "missing_file", message: "Fichier plan de lot manquant" }, { status: 400 });
  }

  if (planFile.size > 18 * 1_048_576) {
    return NextResponse.json({ error: "too_large", message: `Fichier trop volumineux (${(planFile.size / 1_048_576).toFixed(1)} Mo, max 18 Mo)` }, { status: 400 });
  }

  let base64: string;
  let mimeType: string;
  try {
    base64 = Buffer.from(await planFile.arrayBuffer()).toString("base64");
    mimeType = planFile.type || "application/pdf";
  } catch (e) {
    console.error("[plan-lot] file read error:", e);
    return NextResponse.json({ error: "file_read", message: "Impossible de lire le fichier" }, { status: 500 });
  }

  const prompt = `Tu es un géomètre-expert. Analyse ce plan de division / plan de lot cadastral français.

ÉTAPE 1 — Référence cadastrale de la parcelle mère
Dans le cartouche ou le titre du plan, identifie la référence de la parcelle originelle qui est subdivisée :
- commune : code INSEE à 5 chiffres (ex : "33063"). Si tu ne vois que le nom de la commune, laisse vide.
- section : section cadastrale (1 ou 2 lettres/chiffres, ex : "AB", "B", "ZA")
- numero : numéro de la parcelle mère (sans zéros inutiles, ex : "247", "24")

ÉTAPE 2 — Liste des lots créés par la division
Pour chaque lot visible dans le document (LOT 1, LOT 2, Lot A…), indique :
- son identifiant exact tel qu'écrit dans le plan
- sa surface en m² telle qu'indiquée dans le plan (ex : 450.00 m²), ou -1 si non mentionnée

Ne cherche PAS à extraire les coordonnées des bornes ou sommets. La géométrie n'est pas requise.`;

  let geminiRaw: string | null = null;
  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: prompt },
            { inlineData: { mimeType, data: base64 } },
          ] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                parcelle: {
                  type: "OBJECT",
                  nullable: true,
                  description: "Référence cadastrale de la parcelle mère",
                  properties: {
                    commune: { type: "STRING", description: "Code INSEE 5 chiffres" },
                    section: { type: "STRING", description: "Section cadastrale" },
                    numero: { type: "STRING", description: "Numéro de parcelle mère" },
                  },
                  required: ["commune", "section", "numero"],
                },
                lots: {
                  type: "ARRAY",
                  description: "Lots créés par la division",
                  items: {
                    type: "OBJECT",
                    properties: {
                      id: { type: "STRING", description: "Identifiant du lot (ex: LOT 1, Lot A)" },
                      surface: { type: "NUMBER", description: "Surface en m² ou -1 si non indiquée" },
                    },
                    required: ["id", "surface"],
                  },
                },
              },
              required: ["lots"],
            },
          },
        }),
        signal: AbortSignal.timeout(60_000),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("[plan-lot] Gemini HTTP error:", geminiRes.status, errText.slice(0, 400));
      return NextResponse.json({
        error: "gemini", lots: [],
        message: `Erreur Gemini ${geminiRes.status} — le modèle n'a pas pu analyser le document.`,
      });
    }

    const geminiData = await geminiRes.json();
    const finishReason = geminiData.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
      return NextResponse.json({
        error: "gemini_blocked", lots: [],
        message: `Gemini a interrompu l'analyse (${finishReason}). Essayez avec un fichier différent.`,
      });
    }

    geminiRaw = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    if (!geminiRaw) {
      return NextResponse.json({
        error: "empty_response", lots: [],
        message: "Gemini n'a retourné aucune réponse. Réessayez.",
      });
    }
  } catch (e) {
    console.error("[plan-lot] Gemini fetch error:", e);
    return NextResponse.json({ error: "network", lots: [], message: "Impossible de joindre l'API Gemini." });
  }

  let result: {
    parcelle?: { commune: string; section: string; numero: string } | null;
    lots: { id: string; surface: number }[];
  };
  try {
    result = JSON.parse(geminiRaw);
  } catch (e) {
    console.error("[plan-lot] JSON parse error:", geminiRaw?.slice(0, 300), e);
    return NextResponse.json({ error: "json_parse", lots: [], message: "La réponse de Gemini n'est pas du JSON valide." });
  }

  if (!Array.isArray(result.lots) || result.lots.length === 0) {
    return NextResponse.json({
      error: null, lots: [],
      message: "Aucun lot détecté dans le document. Vérifiez que le PDF est bien un plan de division.",
    });
  }

  const ref = result.parcelle;
  console.log(`[plan-lot] Gemini → lots=${result.lots.length}, parcelle=${JSON.stringify(ref)}`);

  // Recherche de la parcelle mère dans l'IGN WFS
  let parentRing: [number, number][] | null = null;
  if (ref?.commune && ref?.section && ref?.numero) {
    parentRing = await fetchParentParcelRing(ref.commune, ref.section, ref.numero);
    console.log(`[plan-lot] IGN WFS idu=${ref.commune}${ref.section.toUpperCase().padStart(2,"0")}${ref.numero.padStart(4,"0")} → ${parentRing ? "trouvée" : "non trouvée"}`);
  }

  if (!parentRing) {
    // Parcelle non trouvée dans IGN : retourne les lots sans polygone
    // L'utilisateur devra cliquer sur sa parcelle dans la carte
    return NextResponse.json({
      error: null,
      lots: result.lots.map((l) => ({ id: l.id, surface: l.surface, polygon: [] as [number,number][] })),
      anchored: false,
      noPolygon: true,
      parcelleRef: ref ?? null,
      message: ref?.commune
        ? `${result.lots.length} lot${result.lots.length > 1 ? "s" : ""} détecté${result.lots.length > 1 ? "s" : ""}, mais la parcelle ${ref.commune} ${ref.section} ${ref.numero} n'a pas été trouvée dans le cadastre IGN. Cliquez sur votre parcelle dans la carte pour la localiser.`
        : `${result.lots.length} lot${result.lots.length > 1 ? "s" : ""} détecté${result.lots.length > 1 ? "s" : ""}. Référence cadastrale non identifiée dans le plan — cliquez sur votre parcelle dans la carte.`,
    });
  }

  // Succès : tous les lots reçoivent la géométrie exacte de la parcelle mère IGN
  const lots: LotPolygon[] = result.lots.map((l) => ({
    id: l.id,
    surface: l.surface,
    polygon: parentRing!,
  }));

  return NextResponse.json({
    error: null,
    lots,
    anchored: true,
    noPolygon: false,
    parcelleRef: ref,
    debug: { lotsExtracted: result.lots.length },
  });
}
