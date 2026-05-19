import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

export const maxDuration = 120;

const PROJECT_LABELS: Record<string, string> = {
  construction_neuve: "Construction neuve (maison individuelle ou bâtiment)",
  agrandissement: "Agrandissement d'un bâtiment existant",
  piscine: "Piscine enterrée ou semi-enterrée",
  abri: "Abri de jardin / Carport / Pergola",
  terrasse: "Terrasse (de plain-pied ou surélevée)",
};

interface AgrandissementDetails {
  surface: "habitable" | "annexe";
  typeDetail: string;
  seuil: "lt20" | "20_40" | "gt40";
}

const AGRAND_TYPE_LABELS: Record<string, string> = {
  surelevation:     "Surélévation / ajout d'un étage",
  extension_rdc:    "Extension de plain-pied (nouvelle pièce accolée)",
  veranda:          "Véranda chauffée (surface habitable)",
  garage_converti:  "Conversion de garage en surface habitable",
  garage:           "Garage / Carport",
  abri_jardin:      "Abri de jardin / local technique",
  atelier:          "Atelier ou bureau indépendant",
  veranda_nc:       "Véranda non chauffée",
};

const AGRAND_SEUIL_LABELS: Record<string, string> = {
  lt20:  "Moins de 20 m² créés (déclaration préalable probable)",
  "20_40": "Entre 20 et 40 m² créés (permis de construire)",
  gt40:  "Plus de 40 m² créés (permis de construire)",
};

function buildAgrandissementContext(d: AgrandissementDetails): string {
  const sfLabel = d.surface === "habitable"
    ? "Surface habitable (comptabilisée dans la surface de plancher)"
    : "Surface non habitable / annexe (ne compte pas dans la SP)";
  return `Sous-type d'agrandissement : ${AGRAND_TYPE_LABELS[d.typeDetail] ?? d.typeDetail}
Nature de la surface : ${sfLabel}
Surface supplémentaire prévue : ${AGRAND_SEUIL_LABELS[d.seuil] ?? d.seuil}`;
}

// ─── Piscine ─────────────────────────────────────────────────────────────────

interface PiscineDetails {
  type:    "enterree" | "horsol";
  surface: "lt10" | "10_100" | "gt100";
  abri:    "non" | "oui";
}

function buildPiscineContext(d: PiscineDetails): string {
  const typeLabel    = d.type    === "enterree" ? "Enterrée / semi-enterrée (permanente)"            : "Hors-sol (structure démontable)";
  const surfaceLabel = d.surface === "lt10"     ? "Moins de 10 m² — souvent dispensée d'autorisation"
                     : d.surface === "10_100"   ? "De 10 à 100 m² — déclaration préalable"
                                                : "Plus de 100 m² — permis de construire";
  const abriLabel    = d.abri   === "oui"       ? "Avec abri ou couverture fixe/rétractable > 1,80 m (PC obligatoire)" : "Sans abri / à ciel ouvert";
  return `Type de piscine : ${typeLabel}\nSurface du bassin : ${surfaceLabel}\nAbri ou couverture : ${abriLabel}`;
}

function buildPiscinePromptFocus(d: PiscineDetails): string {
  const lines = [
    "- Retraits depuis les limites séparatives latérales et de fond (seuil minimal code urba : 1,5 m ; le PLU peut exiger davantage)",
    "- Retrait depuis la voirie si le PLU le précise pour les équipements de loisirs",
    "- Emprise au sol : le bassin + les margelles comptent dans le CES — vérifier si le CES restant sur la parcelle est suffisant",
    "- Zones N et A : les piscines y sont souvent soumises à conditions strictes ou interdites ; préciser la règle exacte",
    "- Risque inondation / PPRi : signaler si la zone peut être concernée",
  ];
  if (d.type === "horsol") {
    lines.push("- Piscine hors-sol < 1 m de profondeur installée < 3 mois : dispensée d'autorisation (art. R421-2 CU), mais retraits conseillés");
    lines.push("- Si installation permanente (> 3 mois) ou profondeur > 1 m : mêmes règles qu'une piscine enterrée");
  }
  if (d.type === "enterree" && d.surface === "lt10") {
    lines.push("- Piscine enterrée < 10 m² : dispensée d'autorisation en zone ordinaire SAUF secteur protégé ABF, périmètre monument historique ou site classé");
    lines.push("- Vérifier si la zone PLU est classée ou si la commune est en périmètre ABF — une DP peut alors être nécessaire");
  }
  if (d.surface === "gt100" || d.abri === "oui") {
    lines.push("- Permis de construire obligatoire : bassin > 100 m² OU couverture > 1,80 m de hauteur");
    lines.push("- Règles d'aspect architectural et d'intégration paysagère peuvent s'appliquer comme pour une construction");
  }
  return lines.join("\n");
}

// ─── Abri / Pergola / Véranda ─────────────────────────────────────────────────

interface AbriDetails {
  type:         "abri_jardin" | "carport" | "pergola" | "veranda";
  surface:      "lt5" | "5_20" | "gt20";
  implantation: "adosse" | "independant";
}

const ABRI_TYPE_LABELS: Record<string, string> = {
  abri_jardin: "Abri de jardin / local technique",
  carport:     "Carport / abri voiture",
  pergola:     "Pergola (ouverte ou semi-ouverte)",
  veranda:     "Véranda légère (non chauffée)",
};

const ABRI_SURFACE_LABELS: Record<string, string> = {
  lt5:  "Moins de 5 m² — souvent dispensé d'autorisation",
  "5_20": "De 5 à 20 m² — déclaration préalable",
  gt20: "Plus de 20 m² — permis de construire",
};

function buildAbriContext(d: AbriDetails): string {
  const implLabel = d.implantation === "adosse"
    ? "Adossé à la construction principale"
    : "Indépendant dans le jardin";
  return `Sous-type : ${ABRI_TYPE_LABELS[d.type] ?? d.type}
Surface prévue : ${ABRI_SURFACE_LABELS[d.surface] ?? d.surface}
Implantation : ${implLabel}`;
}

function buildAbriPromptFocus(d: AbriDetails): string {
  const lines = [
    "- Règles applicables aux petites constructions et annexes (article annexes / dépendances du PLU)",
    "- Emprise au sol maximale des annexes et abris dans cette zone",
    "- Hauteur maximale autorisée pour ce type de construction légère",
    "- Implantation en limite séparative latérale ou de fond : conditions (hauteur seuil, emprise max)",
    "- Retrait minimal depuis la voirie si l'abri est côté rue",
  ];
  if (d.surface === "lt5") {
    lines.push("- Moins de 5 m² : dispensé d'autorisation (art. R421-2 CU) sauf secteur ABF/monument historique/site classé");
    lines.push("- Vérifier si la commune ou la zone PLU impose néanmoins une déclaration préalable");
  }
  if (d.type === "carport") {
    lines.push("- Carport : préciser si un accès direct depuis la voirie est exigé ou interdit");
    lines.push("- Stationnement : un carport compte-t-il comme place réglementaire dans cette zone ?");
  }
  if (d.type === "pergola") {
    lines.push("- Pergola ouverte (sans toiture fixe imperméable) : souvent soumise aux mêmes règles qu'une terrasse couverte");
    lines.push("- Si la pergola est couverte (bâche, polycarbonate) : emprise au sol comptabilisée");
  }
  if (d.type === "veranda") {
    lines.push("- Véranda légère non chauffée : emprise au sol généralement comptabilisée dans le CES");
    lines.push("- Aspect extérieur : matériaux, transparence, intégration à la construction existante");
  }
  if (d.implantation === "adosse") {
    lines.push("- Adossé à la construction principale : vérifier si les règles d'implantation de l'annexe s'appliquent ou celles de la construction principale");
  }
  if (d.implantation === "independant") {
    lines.push("- Construction indépendante : retraits depuis toutes les limites séparatives à vérifier");
  }
  return lines.join("\n");
}

function buildAgrandissementPromptFocus(d: AgrandissementDetails): string {
  const focuses: Record<string, string> = {
    surelevation: `- Hauteur maximale autorisée (article hauteur) : mesure depuis le sol naturel, acrotère ou faîtage
- Gabarit et prospect (règle L+D ou equivalent) depuis les limites et la voirie
- Règles d'aspect extérieur : pente de toiture, matériaux, continuité avec l'existant
- Surélévation implique-t-elle un changement de destination ou la création d'un logement supplémentaire ? Si oui : règles parking d'un logement neuf`,
    extension_rdc: `- Emprise au sol maximale (CES ou %) et surface déjà bâtie à prendre en compte
- Retraits par rapport aux limites latérales et de fond pour une extension
- Bande de constructibilité principale si elle existe dans ce PLU
- Impact sur le stationnement si la surface totale dépasse 60 m²`,
    veranda: `- Emprise au sol : une véranda chauffée compte dans le CES et la surface de plancher
- Règles d'aspect extérieur et matériaux (souvent vitrages réglementés)
- Retraits depuis limites séparatives`,
    garage_converti: `- Changement de destination : le PLU autorise-t-il la conversion d'un garage en pièce habitable ?
- Impact sur le nombre de places de stationnement (la suppression d'un garage peut être compensée)
- Surface de plancher créée : seuil déclaration préalable vs permis de construire`,
    garage: `- Règles spécifiques aux annexes et aux garages (article annexes / constructions secondaires)
- Hauteur maximale des annexes et garages
- Implantation en limite séparative : conditions (hauteur ≤ 3,2 m ? emprise max ?)
- Retrait depuis voirie si garage accès voiture
- Stationnement : un garage intégré compte-t-il comme place réglementaire ?`,
    abri_jardin: `- Règles pour les petits bâtiments et annexes (article constructions légères)
- Emprise maximale des annexes
- Implantation en limite séparative latérale ou de fond : conditions
- Moins de 20 m² : déclaration préalable souvent suffisante ; règles allégées fréquentes`,
    atelier: `- Destination des constructions : un atelier ou bureau est-il autorisé dans cette zone ?
- Emprise au sol et surface de plancher de l'annexe
- Règles d'aspect extérieur pour une construction distincte
- Retrait depuis limites séparatives`,
    veranda_nc: `- Emprise au sol (véranda froide souvent comptée dans le CES malgré tout)
- Aspect extérieur : matériaux, transparence
- Retrait depuis les limites séparatives`,
  };
  return focuses[d.typeDetail] ?? "- Emprise au sol, retraits, hauteur, aspect extérieur";
}

// ─── Terrasse ─────────────────────────────────────────────────────────────────

interface TerrasseDetails {
  type:      "plainpied" | "surelevee";
  surface:   "lt20" | "20_40" | "gt40";
  couverture: "non" | "oui";
}

function buildTerrasseContext(d: TerrasseDetails): string {
  const typeLabel = d.type === "plainpied"
    ? "De plain-pied (niveau du sol naturel, hauteur ≤ 60 cm)"
    : "Surélevée (hauteur > 60 cm, nécessite un plancher porteur)";
  const surfLabel = d.surface === "lt20"   ? "Moins de 20 m²"
                  : d.surface === "20_40"  ? "De 20 à 40 m²"
                                           : "Plus de 40 m²";
  const couv = d.couverture === "oui"
    ? "Couverte (auvent, pergola avec toiture)"
    : "À ciel ouvert";
  return `Sous-type de terrasse : ${typeLabel}\nSurface prévue : ${surfLabel}\nCouverture : ${couv}`;
}

function buildTerrassePromptFocus(d: TerrasseDetails): string {
  const lines = [
    "- Règles spécifiques aux terrasses dans ce PLU (souvent article « constructions de plain-pied » ou annexes)",
    "- Retrait depuis les limites séparatives : une terrasse de plain-pied est souvent assimilée à un aménagement de sol (retrait nul possible) ; surélevée = même règles qu'une construction",
    "- Emprise au sol : la terrasse compte-t-elle dans le CES ? (dépend du PLU et de la hauteur)",
    "- Autorisation nécessaire : terrasse de plain-pied < 20 m² souvent dispensée ; surélevée ou > 20 m² → déclaration préalable",
  ];
  if (d.type === "plainpied") {
    lines.push("- Terrasse de plain-pied : souvent assimilée à un aménagement extérieur, non comptabilisée dans le CES ni la surface de plancher");
    lines.push("- Vérifier si le PLU impose un retrait minimal même pour les terrasses de plain-pied (certains PLU l'exigent)");
  }
  if (d.type === "surelevee") {
    lines.push("- Terrasse surélevée (> 60 cm) : généralement comptabilisée dans le CES, retraits de construction applicables");
    lines.push("- Préciser la hauteur finie par rapport au sol naturel — le seuil de 60 cm détermine le régime applicable");
    lines.push("- Nécessite souvent une déclaration préalable voire un permis de construire si surface > 20 m²");
  }
  if (d.couverture === "oui") {
    lines.push("- Terrasse couverte : la couverture (auvent, pergola fermée) est comptabilisée dans l'emprise au sol et peut nécessiter un permis de construire");
    lines.push("- Hauteur de la couverture : si > 1,80 m et surface > 20 m² → permis de construire probable");
  }
  if (d.surface === "gt40") {
    lines.push("- Surface > 40 m² : vérifier si le dépassement du seuil de plancher ou d'emprise impose un recours à l'architecte (>150 m² total)");
  }
  return lines.join("\n");
}

// ─── Règles lotissement (CPAP/CCAP) ──────────────────────────────────────────

interface LotissementRules {
  resume?: string;
  retraitVoie?: number;
  retraitLateral?: number;
  retraitFond?: number;
  empriseMax?: number;
  hauteurMax?: number;
  parkingNombrePlaces?: number;
  parkingOuvertSurVoirie?: boolean;
  parkingDetails?: string;
  reglesArchitecturales?: string[];
  autresRegles?: string[];
}

function buildLotissementContext(r: LotissementRules): string {
  const lines: string[] = [];
  if (r.retraitVoie    !== undefined && r.retraitVoie    >= 0) lines.push(`- Retrait voie imposé : ${r.retraitVoie} m`);
  if (r.retraitLateral !== undefined && r.retraitLateral >= 0) lines.push(`- Retrait latéral imposé : ${r.retraitLateral} m`);
  if (r.retraitFond    !== undefined && r.retraitFond    >= 0) lines.push(`- Retrait fond imposé : ${r.retraitFond} m`);
  if (r.empriseMax     !== undefined && r.empriseMax     >= 0) lines.push(`- Emprise au sol max : ${r.empriseMax} %`);
  if (r.hauteurMax     !== undefined && r.hauteurMax     >= 0) lines.push(`- Hauteur max : ${r.hauteurMax} m`);
  if (r.parkingNombrePlaces !== undefined && r.parkingNombrePlaces >= 0)
    lines.push(`- Stationnement : ${r.parkingNombrePlaces} place(s) min${r.parkingOuvertSurVoirie ? ", accès direct voirie obligatoire" : ""}`);
  if (r.parkingDetails) lines.push(`  (${r.parkingDetails})`);
  if (r.reglesArchitecturales?.length) {
    lines.push("- Prescriptions architecturales :");
    r.reglesArchitecturales.forEach((rule) => lines.push(`  · ${rule}`));
  }
  if (r.autresRegles?.length) {
    lines.push("- Autres dispositions :");
    r.autresRegles.forEach((rule) => lines.push(`  · ${rule}`));
  }
  return lines.join("\n");
}

const GPU_API = "https://www.geoportail-urbanisme.gouv.fr/api";

interface GpuFile {
  name?: string;
  type?: string;
  href?: string;
  url?: string;
  libelle?: string;
  fileName?: string;
}

// Extrait le code commune sur 5 chiffres depuis la partition (ex. "DU_30136" → "30136")
function extractCommuneCode(partition: string): string | null {
  const m = partition.match(/(\d{5})/);
  return m ? m[1] : null;
}

function findReglementFile(files: unknown[]): GpuFile | null {
  if (!Array.isArray(files) || files.length === 0) return null;
  const list = files as (GpuFile & { title?: string })[];
  return (
    list.find((f) => /règlement.*(écrit|zone)/i.test(f.title ?? "")) ??
    list.find((f) => /règlement/i.test(f.title ?? "")) ??
    list.find((f) => /regl?ement.*zone/i.test(f.name ?? f.libelle ?? f.fileName ?? "")) ??
    list.find((f) => /regl?ement/i.test(f.name ?? f.libelle ?? f.fileName ?? "")) ??
    list.find((f) => /reglement/i.test(f.href ?? f.url ?? "")) ??
    list.find((f) => (f.type ?? "").toLowerCase().includes("reglement")) ??
    list.find((f) => /\.pdf$/i.test(f.href ?? f.url ?? f.name ?? f.fileName ?? "")) ??
    null
  );
}

async function tryDownloadPdf(url: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "application/pdf";
    const buffer = await res.arrayBuffer();
    // Limite 18 Mo (Gemini supporte ~20 Mo)
    if (buffer.byteLength > 18 * 1024 * 1024) {
      console.warn("[PLU] PDF trop volumineux:", buffer.byteLength);
      return null;
    }
    return { base64: Buffer.from(buffer).toString("base64"), mimeType: contentType.split(";")[0].trim() || "application/pdf" };
  } catch (e) {
    console.error("[PLU] Download error:", e);
    return null;
  }
}

async function tryGetFilesAndDownload(docId: string): Promise<{ base64: string; mimeType: string } | null> {
  // Essai A : endpoint /document/{id}/files
  try {
    const filesRes = await fetch(`${GPU_API}/document/${encodeURIComponent(docId)}/files`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    console.log("[PLU] /files status:", filesRes.status, "for", docId);
    if (filesRes.ok) {
      const raw = await filesRes.json();
      console.log("[PLU] /files response:", JSON.stringify(raw).slice(0, 600));
      const files: unknown[] = Array.isArray(raw) ? raw : (raw.files ?? raw.results ?? []);
      const reglFile = findReglementFile(files);
      if (reglFile) {
        const fileUrl = reglFile.href ?? reglFile.url ?? reglFile.fileName;
        if (fileUrl) {
          const fullUrl = fileUrl.startsWith("http") ? fileUrl : `${GPU_API}${fileUrl}`;
          console.log("[PLU] Téléchargement règlement:", fullUrl);
          const result = await tryDownloadPdf(fullUrl);
          if (result) return result;
        }
      }
    }
  } catch (e) {
    console.error("[PLU] /files error:", e);
  }

  // Essai B : endpoint /document/{id} sans /files (retourne parfois les liens directement)
  try {
    const docRes = await fetch(`${GPU_API}/document/${encodeURIComponent(docId)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    console.log("[PLU] /document/{id} status:", docRes.status, "for", docId);
    if (docRes.ok) {
      const raw = await docRes.json();
      console.log("[PLU] /document/{id} response:", JSON.stringify(raw).slice(0, 600));
      // Cherche des URLs de fichiers dans la réponse
      const urlKeys = ["href", "url", "urlFichier", "urlDocument", "lien", "download"];
      const search = (obj: unknown): string | null => {
        if (!obj || typeof obj !== "object") return null;
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          if (urlKeys.includes(k) && typeof v === "string" && /\.pdf/i.test(v)) return v;
          if (typeof v === "object") { const r = search(v); if (r) return r; }
        }
        return null;
      };
      const pdfUrl = search(raw);
      if (pdfUrl) {
        const fullUrl = pdfUrl.startsWith("http") ? pdfUrl : `${GPU_API}${pdfUrl}`;
        const result = await tryDownloadPdf(fullUrl);
        if (result) return result;
      }
    }
  } catch (e) {
    console.error("[PLU] /document/{id} error:", e);
  }

  return null;
}

async function fetchPluReglementBase64(
  partition: string,
  nomfic?: string,
  gpuDocId?: string,
): Promise<{ base64: string; mimeType: string } | null> {
  if (!partition) return null;
  console.log("[PLU] Recherche document pour partition:", partition);

  // ─── Approche 0 : URL directe via nomfic + gpuDocId (fournis par apicarto zone-urba)
  if (nomfic && gpuDocId) {
    const filename = nomfic.split("#")[0]; // strip "#page=N"
    const downloadUrl = `https://data.geopf.fr/annexes/gpu/documents/${partition}/${gpuDocId}/${filename}`;
    console.log("[PLU] Approche 0 — URL directe:", downloadUrl);
    const result = await tryDownloadPdf(downloadUrl);
    if (result) return result;
  }

  // ─── Approche 1 : endpoint direct Géoportail Urbanisme API
  const direct = await tryGetFilesAndDownload(partition);
  if (direct) return direct;

  // ─── Approche 2 : API Géoportail Urbanisme — recherche par partition
  try {
    const searchRes = await fetch(
      `${GPU_API}/document?partition=${encodeURIComponent(partition)}&_limit=5`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) }
    );
    console.log("[PLU] search?partition status:", searchRes.status);
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      console.log("[PLU] search?partition data:", JSON.stringify(searchData).slice(0, 600));
      const docs: unknown[] = Array.isArray(searchData)
        ? searchData
        : (searchData.results ?? searchData.documents ?? searchData.features ?? []);
      for (const doc of docs as Record<string, unknown>[]) {
        const docId = (doc.partition ?? doc.id ?? doc.codeDoc) as string | undefined;
        if (docId) {
          const result = await tryGetFilesAndDownload(docId);
          if (result) return result;
        }
      }
    }
  } catch (e) {
    console.error("[PLU] search?partition error:", e);
  }

  // ─── Approche 3 : API Géoportail Urbanisme — recherche par code commune
  const codeCommune = extractCommuneCode(partition);
  if (codeCommune) {
    console.log("[PLU] Recherche par code commune:", codeCommune);
    try {
      const searchRes = await fetch(
        `${GPU_API}/document?commune=${codeCommune}&_limit=5`,
        { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) }
      );
      console.log("[PLU] search?commune status:", searchRes.status);
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        console.log("[PLU] search?commune data:", JSON.stringify(searchData).slice(0, 600));
        const docs: unknown[] = Array.isArray(searchData)
          ? searchData
          : (searchData.results ?? searchData.documents ?? searchData.features ?? []);
        for (const doc of docs as Record<string, unknown>[]) {
          const docId = (doc.partition ?? doc.id ?? doc.codeDoc) as string | undefined;
          if (docId) {
            const result = await tryGetFilesAndDownload(docId);
            if (result) return result;
          }
        }
      }
    } catch (e) {
      console.error("[PLU] search?commune error:", e);
    }
  }

  // ─── Approche 4 : apicarto GPU → gpu_doc_id → /files → data.geopf.fr download
  try {
    const apicRes = await fetch(
      `https://apicarto.ign.fr/api/gpu/document?partition=${encodeURIComponent(partition)}&_limit=1`,
      { signal: AbortSignal.timeout(8000) }
    );
    console.log("[PLU] apicarto document status:", apicRes.status);
    if (apicRes.ok) {
      const apicData = await apicRes.json();
      const features = apicData.features ?? [];
      for (const feat of features as Record<string, unknown>[]) {
        const props = (feat.properties ?? {}) as Record<string, unknown>;
        console.log("[PLU] apicarto props:", JSON.stringify(props));

        // gpu_doc_id est le hash utilisé dans les URLs data.geopf.fr
        const gpuDocId = (props.gpu_doc_id ?? props.id) as string | undefined;
        const docPartition = (props.partition ?? partition) as string;

        if (gpuDocId) {
          // Récupère la liste des fichiers via l'API GPU avec le hash
          const filesRes = await fetch(`${GPU_API}/document/${gpuDocId}/files`, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(8000),
          });
          console.log("[PLU] /files via gpu_doc_id status:", filesRes.status);
          if (filesRes.ok) {
            const files = await filesRes.json();
            console.log("[PLU] /files via gpu_doc_id:", JSON.stringify(files).slice(0, 600));
            const reglFile = findReglementFile(Array.isArray(files) ? files : []);
            if (reglFile?.name) {
              // URL de téléchargement : data.geopf.fr/annexes/gpu/documents/{partition}/{gpu_doc_id}/{filename}
              const downloadUrl = `https://data.geopf.fr/annexes/gpu/documents/${docPartition}/${gpuDocId}/${reglFile.name}`;
              console.log("[PLU] Téléchargement règlement:", downloadUrl);
              const result = await tryDownloadPdf(downloadUrl);
              if (result) return result;
            }
          }
        }
      }
    }
  } catch (e) {
    console.error("[PLU] apicarto error:", e);
  }

  // ─── Approche 5 : accès direct data.geopf.fr (répertoire documents)
  try {
    const dirRes = await fetch(
      `https://data.geopf.fr/annexes/gpu/documents/${encodeURIComponent(partition)}/`,
      { signal: AbortSignal.timeout(8000) }
    );
    console.log("[PLU] data.geopf dir status:", dirRes.status, dirRes.headers.get("content-type"));
    if (dirRes.ok) {
      const text = await dirRes.text();
      console.log("[PLU] data.geopf dir:", text.slice(0, 800));
      // Cherche des liens vers des PDFs de règlement
      const matches = [...text.matchAll(/href="([^"]*)/g)].map((m) => m[1]);
      for (const href of matches) {
        if (/reglement/i.test(href) && /\.pdf/i.test(href)) {
          const fullUrl = href.startsWith("http") ? href : `https://data.geopf.fr${href}`;
          const result = await tryDownloadPdf(fullUrl);
          if (result) return result;
        }
      }
    }
  } catch (e) {
    console.error("[PLU] data.geopf dir error:", e);
  }

  console.log("[PLU] Toutes les approches ont échoué — fallback analyse générique");
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { commune, zoneLibelle, zoneDescription, partition, nomfic, gpuDocId, projectType,
            agrandissementDetails, piscineDetails: piscineDetailsRaw, abriDetails: abriDetailsRaw,
            terrasseDetails: terrasseDetailsRaw, lotissementRules: lotissementRulesRaw,
            cpapBase64, cpapMimeType,
            surface, largeur, profondeur, existingBuildings } = body;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY non configurée" }, { status: 500 });
    }

    const projectLabel = PROJECT_LABELS[projectType] ?? projectType;
    const agrandDetails: AgrandissementDetails | null =
      projectType === "agrandissement" && agrandissementDetails ? agrandissementDetails : null;
    const piscineDetails: PiscineDetails | null =
      projectType === "piscine" && piscineDetailsRaw ? piscineDetailsRaw : null;
    const abriDetails: AbriDetails | null =
      projectType === "abri" && abriDetailsRaw ? abriDetailsRaw : null;
    const terrasseDetails: TerrasseDetails | null =
      projectType === "terrasse" && terrasseDetailsRaw ? terrasseDetailsRaw : null;
    const lotissementRules: LotissementRules | null = lotissementRulesRaw ?? null;
    const hasCpap = typeof cpapBase64 === "string" && cpapBase64.length > 0;

    // Tente de récupérer le règlement PDF officiel
    const pluDoc = partition ? await fetchPluReglementBase64(partition, nomfic, gpuDocId) : null;

    // Bloc CPAP JSON (fallback si pas de PDF CPAP)
    const lotContextBlock = !hasCpap && lotissementRules
      ? `\n\nRÈGLES DU LOTISSEMENT (CPAP) — s'appliquent EN PRIORITÉ sur le PLU quand plus restrictives :\n${buildLotissementContext(lotissementRules)}`
      : "";

    const buildingsBlock = Array.isArray(existingBuildings) && existingBuildings.length > 0
      ? `\nConstructions existantes sur la parcelle (source BDTOPO IGN) :\n${
          existingBuildings.map((b: { usage: string; footprintM2: number; hauteur: number; nbEtages: number }) =>
            `  - ${b.usage} : ${b.footprintM2} m² d'emprise, ${b.hauteur} m de hauteur, ${b.nbEtages} étage(s)`
          ).join("\n")
        }\n  → Emprise existante totale : ${existingBuildings.reduce((s: number, b: { footprintM2: number }) => s + b.footprintM2, 0)} m²`
      : "";

    const contextBlock = `Commune : ${commune || "non précisée"} (France)
Zone PLU : ${zoneLibelle}${zoneDescription ? ` — ${zoneDescription}` : ""}
Type de projet : ${projectLabel}${agrandDetails ? `\n${buildAgrandissementContext(agrandDetails)}` : ""}${piscineDetails ? `\n${buildPiscineContext(piscineDetails)}` : ""}${abriDetails ? `\n${buildAbriContext(abriDetails)}` : ""}${terrasseDetails ? `\n${buildTerrasseContext(terrasseDetails)}` : ""}
Surface de la parcelle : ${surface} m²
Dimensions approximatives : ${largeur} × ${profondeur} m${buildingsBlock}${lotContextBlock}`;

    const parts: Record<string, unknown>[] = [];
    const cpapNote = hasCpap
      ? `\n\nIMPORTANT — Un CPAP (Cahier des Prescriptions Architecturales et Paysagères) du lotissement est joint en document supplémentaire. Lis attentivement les deux documents. Pour chaque valeur numérique (retraitVoie, retraitLateral, retraitFond, empriseMax, hauteurMax) et chaque règle architecturale, retiens la valeur ou la règle la PLUS RESTRICTIVE entre le PLU et le CPAP. Signale dans pointsAttention les règles du CPAP plus contraignantes que le PLU. Intègre les prescriptions architecturales du CPAP dans recapSections.`
      : lotissementRules ? `\n\nIMPORTANT — Ce projet est situé dans un lotissement avec un CPAP. Pour chaque valeur numérique, retiens la valeur la PLUS RESTRICTIVE entre le PLU et le CPAP. Signale dans pointsAttention les règles du CPAP plus contraignantes. Intègre les prescriptions architecturales du CPAP dans recapSections.`
      : "";

    const avertissementText = hasCpap
      ? "Cette analyse intègre le règlement PLU et le CPAP du lotissement lus par l'IA. Les règles du CPAP s'appliquent en priorité quand plus restrictives. Vérifiez avec le service urbanisme et l'architecte coordonnateur du lotissement avant tout dépôt de dossier."
      : lotissementRules
      ? "Cette analyse intègre les règles du CPAP du lotissement et une estimation PLU. Vérifiez avec l'architecte coordonnateur et le service urbanisme avant tout dépôt de dossier."
      : pluDoc
      ? "Cette analyse est basée sur le règlement PLU officiel téléchargé depuis le Géoportail de l'Urbanisme. Vérifiez toujours avec le service urbanisme de votre commune avant tout dépôt de dossier."
      : "Cette analyse est générée par intelligence artificielle à titre indicatif uniquement. Elle ne se substitue pas au règlement PLU officiel de votre commune ni à l'avis d'un architecte ou d'un professionnel agréé.";

    if (pluDoc) {
      parts.push({
        text: `Tu es un expert en droit de l'urbanisme français (PLU, RNU, Code de l'Urbanisme).

Le règlement PLU officiel de la commune est joint en premier document PDF. Analyse-le attentivement pour extraire les règles de la zone "${zoneLibelle}".${hasCpap ? ` Un CPAP de lotissement est joint en second document PDF.` : ""}

Contexte :
${contextBlock}

Instructions générales :
- Lis le règlement de la zone "${zoneLibelle}" dans le premier document fourni
- Extrais les valeurs numériques exactes (retraits, emprise, hauteur) telles qu'écrites dans le règlement
- Si une valeur n'est pas précisée dans le document pour cette zone, utilise une estimation typique
- empriseNonReglementee : true si la zone mentionne explicitement "Non réglementée" pour l'emprise au sol, false sinon
- espacesLibresPct : pourcentage minimum d'espaces libres/plantés exigé (extrait du document, 0 si non précisé)
- Pour le stationnement : extrais le nombre total de places, le nombre devant être non closes (ouvertes), et si un accès direct depuis la voirie est exigé
- parkingNonClose : ex. "2 places par logement dont 1 non close" → parkingNonClose = 1
- recapSections : liste structurée de toutes les règles (nature de la zone, interdictions, autorisations, accès, réseaux, implantation, hauteur, emprise, aspect architectural, stationnement, espaces verts, synthèse)
- Cite les articles ou passages spécifiques dans les pointsAttention quand possible
- annexesEnLimite : liste toutes les constructions que le règlement autorise explicitement en limite séparative avec leur emprise max et hauteur max. Laisser vide si aucune exception n'est mentionnée.
- annexeRetraits : pour chaque type d'annexe (piscine, garage, terrasse, autre), extrais le retrait latéral et de fond exigés par le règlement. Si un type est autorisé en limite séparative, mettre enLimite:true et retraitLateral/retraitFond:0. Extraire aussi surfaceMaxM2 (surface ou emprise max en m² pour ce type) et hauteurMaxM (hauteur max en m) si le règlement les mentionne explicitement.
${agrandDetails ? `\nPoints à analyser EN PRIORITÉ pour ce type d'agrandissement :\n${buildAgrandissementPromptFocus(agrandDetails)}` : ""}${piscineDetails ? `\nPoints à analyser EN PRIORITÉ pour ce projet de piscine :\n${buildPiscinePromptFocus(piscineDetails)}` : ""}${abriDetails ? `\nPoints à analyser EN PRIORITÉ pour ce projet d'abri/pergola/véranda :\n${buildAbriPromptFocus(abriDetails)}` : ""}${terrasseDetails ? `\nPoints à analyser EN PRIORITÉ pour ce projet de terrasse :\n${buildTerrassePromptFocus(terrasseDetails)}` : ""}${cpapNote}

Le champ "avertissement" doit être exactement : "${avertissementText}"`,
      });
      parts.push({ inlineData: { mimeType: pluDoc.mimeType, data: pluDoc.base64 } });
    } else {
      parts.push({
        text: `Tu es un expert en droit de l'urbanisme français (PLU, RNU, Code de l'Urbanisme).

Analyse les règles PLU applicables pour ce projet :${hasCpap ? ` Le CPAP du lotissement est joint en document PDF.` : ""}

${contextBlock}

Fournis une analyse basée sur :
- Les règles typiques des zones "${zoneLibelle}" en urbanisme français
- Les spécificités réglementaires du projet "${projectLabel}"
- Les seuils du Code de l'Urbanisme (déclaration préalable / permis de construire)
${agrandDetails    ? `\nPoints à analyser EN PRIORITÉ pour ce type d'agrandissement :\n${buildAgrandissementPromptFocus(agrandDetails)}\n`    : ""}${piscineDetails   ? `\nPoints à analyser EN PRIORITÉ pour ce projet de piscine :\n${buildPiscinePromptFocus(piscineDetails)}\n`   : ""}${abriDetails      ? `\nPoints à analyser EN PRIORITÉ pour ce projet d'abri/pergola/véranda :\n${buildAbriPromptFocus(abriDetails)}\n`      : ""}${terrasseDetails  ? `\nPoints à analyser EN PRIORITÉ pour ce projet de terrasse :\n${buildTerrassePromptFocus(terrasseDetails)}\n`  : ""}${cpapNote}
Instructions pour les valeurs numériques :
- Retrait voie : valeur médiane la plus courante pour ce type de zone
- Zones N et A : valeurs très restrictives (agrandissement limité à 30 % de l'existant, emprise réduite)
- Piscine : retrait typique 1-3 m des limites séparatives
- Abri/carport < 20 m² : règles souvent allégées
- Terrasse de plain-pied : retraits souvent nuls ou réduits
- Si la zone permet peu de construire (N, A), mettre empriseMax ≤ 15 et hauteurMax ≤ 6

Les "pointsAttention" doivent être spécifiques au type et sous-type de projet.

Instructions pour les champs structurels :
- empriseNonReglementee : true si la zone ne réglemente pas l'emprise au sol, false sinon
- espacesLibresPct : mettre TOUJOURS 0 en mode estimation
- parkingNonClose : 0 en maison individuelle sauf règle explicite
- annexesEnLimite : laisser vide [] en mode estimation
- annexeRetraits : renseigner pour chaque type d'annexe courant (piscine, garage, terrasse, autre) avec les valeurs typiques de la zone. Piscine : retraitLateral 1.5 m typique. Garage/terrasse de plain-pied : souvent enLimite:true selon le PLU. Renseigner surfaceMaxM2 et hauteurMaxM avec des valeurs typiques si elles sont courantes dans ce type de zone (ex: garage ≤ 40 m² H ≤ 3.5 m, piscine surface selon déclaration préalable).
- recapSections : résumé structuré (nature de la zone, interdictions, autorisations, accès, réseaux, implantation, hauteur, emprise, aspect architectural, stationnement, espaces verts, synthèse)

Instructions pour le stationnement :
- Construction neuve : 2 places minimum
- Agrandissement surface habitable > 60 m² créés : souvent 1 place supplémentaire
- Surélévation créant un logement supplémentaire : règles logement neuf
- Conversion garage → habitable : peut supprimer une place, vérifier compensation exigée
- Garage, abri, piscine, terrasse : 0 places requises en général
- parkingOuvertSurVoirie = true en zones UA/UB denses uniquement

Le champ "avertissement" doit être exactement : "${avertissementText}"`,
      });
    }

    // Ajoute le CPAP comme document PDF inline supplémentaire
    if (hasCpap) {
      parts.push({ inlineData: { mimeType: cpapMimeType || "application/pdf", data: cpapBase64 } });
    }

    const geminiPayload = {
      contents: [{ parts }],
      generationConfig: {
        temperature: pluDoc ? 0.1 : 0.3,
        responseMimeType: "application/json",
        responseSchema: {
              type: "OBJECT",
              properties: {
                resume: { type: "STRING" },
                retraitVoie: { type: "NUMBER" },
                retraitLateral: { type: "NUMBER" },
                retraitFond: { type: "NUMBER" },
                empriseMax: { type: "NUMBER" },
                hauteurMax: { type: "NUMBER" },
                empriseNonReglementee: { type: "BOOLEAN", description: "True si l'emprise au sol n'est pas réglementée dans cette zone (mention 'Non réglementée' ou absence de règle)" },
                espacesLibresPct: { type: "NUMBER", description: "Pourcentage minimum d'espaces libres/plantés exigé (0 si non réglementé)" },
                parkingNombrePlaces: { type: "NUMBER" },
                parkingNonClose: { type: "NUMBER", description: "Nombre de places devant obligatoirement rester non closes (ouvertes, non couvertes). Ex : '2 places dont 1 non close' → 1" },
                parkingOuvertSurVoirie: { type: "BOOLEAN" },
                parkingDetails: { type: "STRING" },
                pointsAttention: { type: "ARRAY", items: { type: "STRING" } },
                recommandation: { type: "STRING" },
                avertissement: { type: "STRING" },
                isZac: { type: "BOOLEAN", description: "True si la zone est une ZAC ou soumise à une opération d'aménagement d'ensemble" },
                recapSections: {
                  type: "ARRAY",
                  description: "Récap structuré de toutes les règles principales par catégorie",
                  items: {
                    type: "OBJECT",
                    properties: {
                      titre: { type: "STRING" },
                      items: { type: "ARRAY", items: { type: "STRING" } },
                    },
                  },
                },
                annexesEnLimite: {
                  type: "ARRAY",
                  description: "Constructions autorisées en limite séparative (implantation sans retrait par rapport aux limites latérales). Laisser vide si aucune exception.",
                  items: {
                    type: "OBJECT",
                    properties: {
                      type: { type: "STRING", description: "Ex : Annexe, Garage, Sanitaire non contigu à l'habitation" },
                      empriseMaxM2: { type: "NUMBER", description: "Emprise au sol maximale en m²" },
                      hauteurMaxM: { type: "NUMBER", description: "Hauteur maximale en mètres" },
                    },
                  },
                },
                annexeRetraits: {
                  type: "ARRAY",
                  description: "Retraits spécifiques par type d'annexe extraits du PLU/CPAP. Renseigner pour chaque type concerné : piscine, garage, terrasse, autre.",
                  items: {
                    type: "OBJECT",
                    properties: {
                      type: { type: "STRING", description: "Type d'annexe : piscine | garage | terrasse | autre" },
                      retraitLateral: { type: "NUMBER", description: "Retrait latéral minimal en m (0 si en limite autorisé)" },
                      retraitFond: { type: "NUMBER", description: "Retrait de fond minimal en m (0 si en limite autorisé)" },
                      enLimite: { type: "BOOLEAN", description: "True si le PLU autorise explicitement l'implantation en limite séparative" },
                      surfaceMaxM2: { type: "NUMBER", description: "Surface de plancher ou emprise au sol maximale en m² pour ce type d'annexe (ex: 20, 40). Omettre si non réglementé." },
                      hauteurMaxM: { type: "NUMBER", description: "Hauteur maximale en mètres pour ce type d'annexe (ex: 3.5). Omettre si non réglementé." },
                      note: { type: "STRING", description: "Conditions ou précisions du PLU (ex : hauteur max pour être en limite)" },
                    },
                  },
                },
              },
              required: [
                "resume", "retraitVoie", "retraitLateral", "retraitFond",
                "empriseMax", "empriseNonReglementee", "espacesLibresPct", "hauteurMax",
                "parkingNombrePlaces", "parkingNonClose", "parkingOuvertSurVoirie", "parkingDetails",
                "pointsAttention", "recommandation", "avertissement", "isZac", "recapSections",
                "annexesEnLimite", "annexeRetraits",
              ],
        },
      },
    };

    // Retry logic: 3 attempts on 503, then fallback to gemini-2.0-flash
    const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];
    let geminiRes: Response | null = null;
    let lastErrText = "";

    outer: for (const model of MODELS) {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) {
          const delay = 3000 * attempt;
          console.log(`[PLU] ${model} 503 — retry ${attempt}/2 in ${delay}ms`);
          await new Promise((r) => setTimeout(r, delay));
        }
        try {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: AbortSignal.timeout(90_000),
              body: JSON.stringify(geminiPayload),
            }
          );
          if (res.status === 503) { geminiRes = res; continue; }
          geminiRes = res;
          break outer;
        } catch (e) {
          console.error(`[PLU] ${model} attempt ${attempt} error:`, e);
          lastErrText = String(e);
        }
      }
      console.log(`[PLU] ${model} exhausted — trying next model`);
    }

    if (!geminiRes || !geminiRes.ok) {
      const errText = geminiRes ? await geminiRes.text() : lastErrText;
      console.error("Gemini API error:", errText);
      const overloaded = geminiRes?.status === 503;
      return NextResponse.json(
        { error: overloaded ? "Serveur IA surchargé" : "Erreur API Gemini", overloaded },
        { status: 502 }
      );
    }

    const geminiData = await geminiRes.json();
    // Gemini 2.5 Flash inserts thought parts (thought: true) before the actual response.
    // Find the first non-thought text part to get the JSON response.
    const rawParts: { thought?: boolean; text?: string }[] =
      geminiData.candidates?.[0]?.content?.parts ?? [];
    const textPart = rawParts.find((p) => !p.thought && typeof p.text === "string" && p.text.length > 0);
    const text = textPart?.text;
    if (!text) return NextResponse.json({ error: "Réponse vide" }, { status: 502 });

    const analysis = JSON.parse(text);
    analysis.sourcePluOfficiel = !!pluDoc;

    // Notification silencieuse au propriétaire (aucune info personnelle requise)
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "inconnue";
      const now = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
      await resend.emails.send({
        from: "Metaconception <contact@metaconception.eu>",
        to: process.env.CONTACT_EMAIL!,
        subject: `[PLU] Analyse — ${commune || "?"}, ${zoneLibelle || "?"}`,
        html: `
          <div style="font-family:sans-serif;max-width:480px;color:#221e18;">
            <h2 style="font-size:16px;border-bottom:2px solid #b5651d;padding-bottom:8px;margin-bottom:16px;">Nouvelle analyse PLU</h2>
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
              <tr><td style="color:#8a8070;padding:5px 0;width:150px;">Date</td><td>${now}</td></tr>
              <tr style="background:#f5f0e6;"><td style="color:#8a8070;padding:5px 8px;">Commune</td><td style="padding:5px 8px;">${commune || "—"}</td></tr>
              <tr><td style="color:#8a8070;padding:5px 0;">Zone PLU</td><td>${zoneLibelle || "—"}${zoneDescription ? ` (${zoneDescription})` : ""}</td></tr>
              <tr style="background:#f5f0e6;"><td style="color:#8a8070;padding:5px 8px;">Type de projet</td><td style="padding:5px 8px;">${PROJECT_LABELS[projectType] ?? projectType ?? "—"}</td></tr>
              <tr><td style="color:#8a8070;padding:5px 0;">Surface parcelle</td><td>${surface ? `${surface} m²` : "—"}</td></tr>
              <tr style="background:#f5f0e6;"><td style="color:#8a8070;padding:5px 8px;">IP</td><td style="padding:5px 8px;">${ip}</td></tr>
              <tr><td style="color:#8a8070;padding:5px 0;">PLU officiel trouvé</td><td>${pluDoc ? "✅ Oui" : "❌ Non (estimation IA)"}</td></tr>
            </table>
          </div>`,
      });
    } catch {
      // Notification facultative — on n'interrompt pas la réponse si ça échoue
    }

    return NextResponse.json(analysis);
  } catch (err) {
    console.error("plu-analysis error:", err);
    return NextResponse.json({ error: "Erreur interne" }, { status: 500 });
  }
}
