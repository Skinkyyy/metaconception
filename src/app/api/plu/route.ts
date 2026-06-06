import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

export const maxDuration = 120;

const GPU_API = "https://data.geopf.fr/gpu/api";

// ── GPU zone detection ─────────────────────────────────────────────────────────

async function detectZone(lat: number, lon: number): Promise<{
  partition: string;
  zoneLibelle: string;
  zoneDescription: string;
  commune: string;
  nomfic?: string;
  gpuDocId?: string;
} | null> {
  try {
    const geom = encodeURIComponent(JSON.stringify({ type: "Point", coordinates: [lon, lat] }));
    const res = await fetch(
      `https://apicarto.ign.fr/api/gpu/zone-urba?geom=${geom}`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const feat = data.features?.[0];
    if (!feat) return null;
    const p = feat.properties ?? {};
    return {
      partition:       p.partition ?? "",
      zoneLibelle:     p.libelle ?? p.zone ?? "",
      zoneDescription: p.typezone ?? "",
      commune:         p.nomcom ?? p.commune ?? "",
      nomfic:          p.nomfic ?? undefined,
      gpuDocId:        p.gpu_doc_id ?? undefined,
    };
  } catch {
    return null;
  }
}

// ── PDF download ───────────────────────────────────────────────────────────────

async function tryDownloadPdf(url: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "application/pdf";
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > 18 * 1024 * 1024) return null;
    return {
      base64: Buffer.from(buffer).toString("base64"),
      mimeType: contentType.split(";")[0].trim() || "application/pdf",
    };
  } catch {
    return null;
  }
}

function findReglementFile(files: unknown[]): Record<string, unknown> | null {
  const isReglement = (name: string) =>
    /reglement/i.test(name) || /r[eè]glement/i.test(name) || /r[eè]gl/i.test(name);
  for (const f of files as Record<string, unknown>[]) {
    const name = (f.name ?? f.fileName ?? f.href ?? "") as string;
    if (isReglement(name) && /\.pdf/i.test(name)) return f;
  }
  for (const f of files as Record<string, unknown>[]) {
    const name = (f.name ?? f.fileName ?? f.href ?? "") as string;
    if (/\.pdf/i.test(name)) return f;
  }
  return null;
}

async function fetchPluPdf(
  partition: string,
  nomfic?: string,
  gpuDocId?: string,
): Promise<{ base64: string; mimeType: string } | null> {
  if (!partition) return null;

  // Approche 0 : URL directe nomfic + gpuDocId
  if (nomfic && gpuDocId) {
    const filename = nomfic.split("#")[0];
    const url = `https://data.geopf.fr/annexes/gpu/documents/${partition}/${gpuDocId}/${filename}`;
    const result = await tryDownloadPdf(url);
    if (result) return result;
  }

  // Approche 1 : apicarto → gpu_doc_id → /files
  try {
    const apicRes = await fetch(
      `https://apicarto.ign.fr/api/gpu/document?partition=${encodeURIComponent(partition)}&_limit=1`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (apicRes.ok) {
      const apicData = await apicRes.json();
      for (const feat of (apicData.features ?? []) as Record<string, unknown>[]) {
        const props = (feat.properties ?? {}) as Record<string, unknown>;
        const docId = (props.gpu_doc_id ?? props.id) as string | undefined;
        const docPartition = (props.partition ?? partition) as string;
        if (docId) {
          const filesRes = await fetch(`${GPU_API}/document/${docId}/files`, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(8000),
          });
          if (filesRes.ok) {
            const files = await filesRes.json();
            const reglFile = findReglementFile(Array.isArray(files) ? files : []);
            if (reglFile?.name) {
              const url = `https://data.geopf.fr/annexes/gpu/documents/${docPartition}/${docId}/${reglFile.name}`;
              const result = await tryDownloadPdf(url);
              if (result) return result;
            }
          }
        }
      }
    }
  } catch { /* continue */ }

  // Approche 2 : endpoint direct GPU
  try {
    const filesRes = await fetch(`${GPU_API}/document/${encodeURIComponent(partition)}/files`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (filesRes.ok) {
      const files = await filesRes.json();
      const reglFile = findReglementFile(Array.isArray(files) ? files : []);
      if (reglFile) {
        const fileUrl = (reglFile.href ?? reglFile.url ?? reglFile.fileName) as string | undefined;
        if (fileUrl) {
          const fullUrl = fileUrl.startsWith("http") ? fileUrl : `${GPU_API}${fileUrl}`;
          const result = await tryDownloadPdf(fullUrl);
          if (result) return result;
        }
      }
    }
  } catch { /* continue */ }

  return null;
}

// ── Gemini call ────────────────────────────────────────────────────────────────

const GEMINI_SCHEMA = {
  type: "OBJECT",
  properties: {
    resume:               { type: "STRING" },
    zoneLibelle:          { type: "STRING" },
    commune:              { type: "STRING" },
    retraitVoie:          { type: "NUMBER" },
    retraitLateral:       { type: "NUMBER" },
    retraitFond:          { type: "NUMBER" },
    empriseMaxPct:        { type: "NUMBER", description: "Emprise max en pourcentage (ex: 40 pour 40%)" },
    hauteurMax:           { type: "NUMBER" },
    espacesVertsPct:      { type: "NUMBER", description: "Pourcentage min d'espaces verts/libres (0 si non réglementé)" },
    parkingPlaces:        { type: "NUMBER" },
    sourcePlu:            { type: "BOOLEAN", description: "True si le PDF officiel PLU a été analysé" },
    pointsAttention:      { type: "ARRAY", items: { type: "STRING" } },
    resume_cpap:          { type: "STRING", description: "Résumé des règles CPAP si présent, sinon chaîne vide" },
    avertissement:        { type: "STRING" },
    // Règles spécifiques aux annexes / dépendances
    retraitVoirieAnnexe:  { type: "NUMBER", description: "Retrait voirie minimal pour annexes/dépendances en mètres (peut différer du bâtiment principal ; 0 si non précisé)" },
    surfaceMaxAnnexe:     { type: "NUMBER", description: "Surface de plancher ou d'emprise max pour une annexe en m² (0 si non précisé)" },
    longueurMaxAnnexe:    { type: "NUMBER", description: "Longueur ou dimension max d'une annexe en mètres (0 si non précisé)" },
    hauteurMaxAnnexe:     { type: "NUMBER", description: "Hauteur max des annexes/dépendances en mètres (0 si non précisé)" },
  },
  required: [
    "resume", "zoneLibelle", "commune",
    "retraitVoie", "retraitLateral", "retraitFond",
    "empriseMaxPct", "hauteurMax", "espacesVertsPct",
    "parkingPlaces", "sourcePlu", "pointsAttention", "resume_cpap", "avertissement",
    "retraitVoirieAnnexe", "surfaceMaxAnnexe", "longueurMaxAnnexe", "hauteurMaxAnnexe",
  ],
};

// ── POST handler ───────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      lat, lon, surface,
      cpapBase64, cpapMimeType,
    }: {
      lat: number;
      lon: number;
      surface: number;
      cpapBase64?: string;
      cpapMimeType?: string;
    } = body;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY non configurée" }, { status: 500 });
    }

    // 1. Détecter la zone PLU
    const zone = await detectZone(lat, lon);
    const partition    = zone?.partition    ?? "";
    const zoneLibelle  = zone?.zoneLibelle  ?? "Zone inconnue";
    const commune      = zone?.commune      ?? "";

    // 2. Télécharger le PDF du règlement
    const pluDoc = partition
      ? await fetchPluPdf(partition, zone?.nomfic, zone?.gpuDocId)
      : null;

    const hasCpap = typeof cpapBase64 === "string" && cpapBase64.length > 0;

    // 3. Construire le prompt
    const contextBlock = `Commune : ${commune || "inconnue"} (France)
Zone PLU : ${zoneLibelle}${zone?.zoneDescription ? ` (${zone.zoneDescription})` : ""}
Surface de la parcelle : ${surface} m²
Projet : construction neuve / plan de masse`;

    const cpapNote = hasCpap
      ? `\n\nIMPORTANT — Un CPAP (Cahier des Prescriptions Architecturales et Paysagères) est joint. Retiens la valeur la PLUS RESTRICTIVE entre le PLU et le CPAP pour chaque règle numérique. Résume les règles CPAP dans le champ resume_cpap.`
      : "";

    const avertissement = pluDoc
      ? "Analyse basée sur le règlement PLU officiel (Géoportail de l'Urbanisme). Vérifiez avec le service urbanisme avant tout dépôt."
      : "Analyse estimée par IA (règlement PDF non disponible). Consultez le PLU officiel de votre mairie.";

    const heightNote = `
HAUTEURS ET DIMENSIONS ANNEXES — lecture experte obligatoire :
Tu es experte en PLU, droit foncier et architecture. Tu dois lire chaque article en entier avant d'extraire une valeur. Une erreur de lecture peut avoir des conséquences réglementaires graves.

- hauteurMax : hauteur maximale du bâtiment PRINCIPAL (habitation, bureau). Articles "hauteur" ou "gabarit" pour constructions principales. Valeur typique 6–12 m. JAMAIS la hauteur des annexes.

- hauteurMaxAnnexe : hauteur maximale applicable aux annexes, dépendances, garages pouvant s'implanter en limite séparative ou à faible recul.
  ATTENTION : un même article peut contenir PLUSIEURS seuils de hauteur selon des conditions :
  • Certains PLU autorisent une annexe à 4 m (ou plus) en limite si certaines conditions sont remplies (profondeur minimale, etc.) → c'est ce seuil qui s'applique pour une construction fermée standard.
  • Une hauteur plus basse (ex: 3 m) peut s'appliquer uniquement aux "constructions couvertes et non closes" (pergolas, abris ouverts) → ce cas particulier NE s'applique PAS aux annexes fermées.
  → Retourne la hauteur maximale applicable aux ANNEXES FERMÉES (garage, abri de jardin clos). Si plusieurs seuils, prends le plus élevé autorisé pour une construction fermée standard. Si non précisé → 0.

- surfaceMaxAnnexe : emprise au sol ou surface de plancher maximale pour UNE annexe (ex : "30 m²", "20 m²"). En m², 0 si non précisé.

- longueurMaxAnnexe : longueur maximale cumulée ou dimension maximale d'une annexe le long des limites séparatives (ex : "10 m de longueur cumulée sur l'ensemble des limites"). En mètres, 0 si non précisé. Lis TOUT l'article — cette valeur peut être en fin de paragraphe.

- retraitVoirieAnnexe : retrait minimal côté voirie pour les annexes (souvent différent du bâtiment principal, parfois 0 m "en limite de voirie"). 0 si identique au principal.

Ne jamais confondre ces cinq champs entre eux. Chaque valeur doit venir d'une lecture précise du texte.`;

    const promptText = pluDoc
      ? `Tu es un expert en droit de l'urbanisme français.

Le règlement PLU officiel est joint en PDF. Lis-le attentivement et extrais les règles applicables à la zone "${zoneLibelle}".

${contextBlock}

Instructions :
- Lis l'intégralité des articles de la zone "${zoneLibelle}" avant de répondre
- Extrais les valeurs numériques exactes telles qu'écrites dans le document
- empriseMaxPct : exprimé en pourcentage (ex: 40 pour CES=0.4 ou emprise=40%)
- espacesVertsPct : % minimum d'espaces libres/plantés (0 si non précisé)
- sourcePlu : true (PDF officiel analysé)
- Le champ "avertissement" doit être exactement : "${avertissement}"
${heightNote}${cpapNote}`
      : `Tu es un expert en droit de l'urbanisme français.

Analyse les règles PLU pour ce projet :

${contextBlock}

Instructions :
- Utilise tes connaissances des règles typiques de la zone "${zoneLibelle}"
- empriseMaxPct : exprimé en pourcentage
- sourcePlu : false (estimation, pas de PDF)
- Le champ "avertissement" doit être exactement : "${avertissement}"
${heightNote}${cpapNote}`;

    const parts: Record<string, unknown>[] = [{ text: promptText }];
    if (pluDoc) parts.push({ inlineData: { mimeType: pluDoc.mimeType, data: pluDoc.base64 } });
    if (hasCpap) parts.push({ inlineData: { mimeType: cpapMimeType ?? "application/pdf", data: cpapBase64 } });

    const geminiPayload = {
      contents: [{ parts }],
      generationConfig: {
        temperature: pluDoc ? 0.1 : 0.3,
        responseMimeType: "application/json",
        responseSchema: GEMINI_SCHEMA,
      },
    };

    // 4. Appel Gemini avec retry
    const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
    let result: Record<string, unknown> | null = null;
    let lastError = "";

    outer: for (const model of MODELS) {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 3000 * attempt));
        try {
          const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(geminiPayload),
              signal: AbortSignal.timeout(90000),
            },
          );
          if (geminiRes.status === 503 || geminiRes.status === 429) {
            lastError = `${model}: HTTP ${geminiRes.status}`;
            continue;
          }
          if (!geminiRes.ok) {
            const err = await geminiRes.text();
            lastError = `${model}: HTTP ${geminiRes.status} — ${err.slice(0, 200)}`;
            console.error(`[PLU] Gemini ${model} error ${geminiRes.status}:`, err.slice(0, 300));
            break; // erreur non-retryable sur ce modèle, passer au suivant
          }
          const geminiData = await geminiRes.json();
          const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!text) {
            const reason = geminiData.candidates?.[0]?.finishReason ?? "no_text";
            lastError = `${model}: ${reason}`;
            console.error(`[PLU] Gemini ${model} no text, reason:`, reason, JSON.stringify(geminiData).slice(0, 300));
            break;
          }
          result = JSON.parse(text);
          break outer;
        } catch (fetchErr) {
          lastError = `${model}: ${String(fetchErr).slice(0, 100)}`;
          console.error(`[PLU] Gemini ${model} fetch error:`, fetchErr);
        }
      }
    }

    if (!result) {
      console.error("[PLU] Tous les modèles ont échoué. Dernier erreur:", lastError);
      return NextResponse.json({ error: "Analyse IA indisponible", detail: lastError }, { status: 503 });
    }

    // Notification email silencieuse
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "inconnue";
      const now = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
      await resend.emails.send({
        from: "Metaconception <contact@metaconception.eu>",
        to: process.env.CONTACT_EMAIL!,
        subject: `[Plan de masse] Analyse PLU — ${commune || "?"}, ${zoneLibelle || "?"}`,
        html: `
          <div style="font-family:sans-serif;max-width:480px;color:#221e18;">
            <h2 style="font-size:16px;border-bottom:2px solid #b5651d;padding-bottom:8px;margin-bottom:16px;">Nouvelle analyse PLU — Plan de masse</h2>
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
              <tr><td style="color:#8a8070;padding:5px 0;width:150px;">Date</td><td>${now}</td></tr>
              <tr style="background:#f5f0e6;"><td style="color:#8a8070;padding:5px 8px;">Commune</td><td style="padding:5px 8px;">${commune || "—"}</td></tr>
              <tr><td style="color:#8a8070;padding:5px 0;">Zone PLU</td><td>${zoneLibelle || "—"}${zone?.zoneDescription ? ` (${zone.zoneDescription})` : ""}</td></tr>
              <tr style="background:#f5f0e6;"><td style="color:#8a8070;padding:5px 8px;">Surface parcelle</td><td style="padding:5px 8px;">${surface ? `${surface} m²` : "—"}</td></tr>
              <tr><td style="color:#8a8070;padding:5px 0;">IP</td><td>${ip}</td></tr>
              <tr style="background:#f5f0e6;"><td style="color:#8a8070;padding:5px 8px;">PLU officiel trouvé</td><td style="padding:5px 8px;">${pluDoc ? "✅ Oui" : "❌ Non (estimation IA)"}</td></tr>
            </table>
          </div>`,
      });
    } catch {
      // Notification facultative — on n'interrompt pas la réponse si ça échoue
    }

    return NextResponse.json({
      ...result,
      zone: { partition, zoneLibelle, commune, description: zone?.zoneDescription },
    });
  } catch (e) {
    console.error("[PLU API]", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
