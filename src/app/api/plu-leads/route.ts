import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { Resend } from "resend";
import { NextResponse } from "next/server";
import { generatePluPdf } from "@/lib/plu-pdf";

const resend = new Resend(process.env.RESEND_API_KEY);

// ── Types ──────────────────────────────────────────────────────────────────

interface DrawnShapeInfo {
  label: string;
  type: string;
  surfaceM2: number;
  niveaux?: string;
  polygon?: [number, number][]; // [lat, lon][] — optionnel pour les coordonnées
}

interface AiAnalysisInfo {
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
}

interface LeadPayload {
  prenom: string;
  nom: string;
  email: string;
  adresseProjet: string;
  commune: string;
  parcelRef: string;
  parcelSurface: number;
  projectTypeLabel: string;
  existingM2: number;
  drawnM2: number;
  totalM2: number;
  empriseP: number;
  drawnShapes: DrawnShapeInfo[];
  aiAnalysis: AiAnalysisInfo | null;
  // Geometrie pour le PDF
  parcelRing?: [number, number][];
  zoneMain?: [number, number][] | null;
  zoneAnnex?: [number, number][] | null;
  drawnShapesWithCoords?: {
    label: string;
    type: string;
    surfaceM2: number;
    niveaux?: string;
    polygon: [number, number][];
  }[];
}

// ── Sauvegarde fichier (dev / auto-hébergé) ────────────────────────────────

function saveLeadToFile(lead: Record<string, unknown>) {
  try {
    const dir = path.join(process.cwd(), "data");
    if (!existsSync(dir)) mkdirSync(dir);
    const filePath = path.join(dir, "plu-leads.json");
    const leads = existsSync(filePath)
      ? (JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>[])
      : [];
    leads.push({ ...lead, createdAt: new Date().toISOString() });
    writeFileSync(filePath, JSON.stringify(leads, null, 2));
  } catch {
    // Vercel: filesystem éphémère, on ignore
  }
}

// ── Template email utilisateur ─────────────────────────────────────────────

function buildUserEmailHtml(p: LeadPayload): string {
  const header = `
    <div style="background:#221e18;padding:32px 40px;">
      <h1 style="color:#fff;font-size:22px;font-weight:300;letter-spacing:2px;margin:0;text-transform:uppercase;">METACONCEPTION</h1>
      <p style="color:#8a8070;font-size:12px;margin:6px 0 0;letter-spacing:1px;">ANALYSE PLU — RAPPORT DE FAISABILITÉ</p>
    </div>`;

  const intro = `
    <div style="padding:32px 40px 0;">
      <p style="font-size:15px;color:#221e18;">Bonjour ${p.prenom} ${p.nom},</p>
      <p style="font-size:14px;color:#5a5246;line-height:1.7;">Votre rapport d'analyse PLU est disponible ci-dessous. Ce document est généré automatiquement à titre indicatif — pour une analyse approfondie, contactez-nous.</p>
    </div>`;

  const projetBlock = `
    <div style="margin:24px 40px;background:#f5f0e6;border-left:3px solid #b5651d;padding:20px 24px;border-radius:0 8px 8px 0;">
      <h2 style="font-size:13px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#8a8070;margin:0 0 12px;">Projet</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr><td style="color:#8a8070;padding:4px 0;width:160px;">Adresse</td><td style="font-weight:600;">${p.adresseProjet}</td></tr>
        <tr><td style="color:#8a8070;padding:4px 0;">Commune</td><td>${p.commune}</td></tr>
        <tr><td style="color:#8a8070;padding:4px 0;">Référence parcelle</td><td>${p.parcelRef}</td></tr>
        <tr><td style="color:#8a8070;padding:4px 0;">Surface parcelle</td><td>${p.parcelSurface} m²</td></tr>
        <tr><td style="color:#8a8070;padding:4px 0;">Type de projet</td><td>${p.projectTypeLabel}</td></tr>
      </table>
    </div>`;

  const reglesBlock = p.aiAnalysis
    ? buildReglesBlock(p.aiAnalysis)
    : "";

  const shapesRows = p.drawnShapes
    .map(
      (s) =>
        `<tr><td style="padding:8px 0;color:#5a5246;">· ${s.label}${s.niveaux ? ` (${s.niveaux.toUpperCase()})` : ""}</td><td style="padding:8px 0;text-align:right;">${s.surfaceM2} m²</td></tr>`
    )
    .join("");

  const existingRow =
    p.existingM2 > 0
      ? `<tr><td style="padding:8px 0;color:#8a8070;">Existant</td><td style="padding:8px 0;text-align:right;">${p.existingM2} m²</td></tr>`
      : "";

  const surfacesBlock = `
    <div style="margin:0 40px 24px;">
      <h2 style="font-size:13px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#8a8070;margin:0 0 12px;">Bilan de surface</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        ${existingRow}
        ${shapesRows}
        <tr style="border-top:1px solid #e0d9cc;">
          <td style="padding:10px 0;font-weight:700;">Total projet</td>
          <td style="padding:10px 0;font-weight:700;text-align:right;">${p.totalM2} m² · ${p.empriseP}%</td>
        </tr>
      </table>
    </div>`;

  const recommandationBlock =
    p.aiAnalysis?.recommandation
      ? `<div style="margin:0 40px 24px;background:#f0f4ef;border-left:3px solid #4a7a48;padding:20px 24px;border-radius:0 8px 8px 0;">
          <h2 style="font-size:13px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#4a7a48;margin:0 0 10px;">Recommandation</h2>
          <p style="font-size:13px;color:#221e18;line-height:1.7;margin:0;">${p.aiAnalysis.recommandation}</p>
        </div>`
      : "";

  const disclaimer = `
    <div style="margin:0 40px 32px;padding:16px;background:#fff8ee;border:1px solid #e0d9cc;border-radius:8px;">
      <p style="font-size:11px;color:#8a8070;margin:0;line-height:1.6;">⚠️ Ce rapport est généré automatiquement à titre indicatif uniquement. Il ne constitue pas un avis juridique ni une garantie administrative. Consultez un professionnel qualifié avant tout dépôt de dossier.</p>
    </div>`;

  const footer = `
    <div style="background:#f5f0e6;padding:24px 40px;border-top:1px solid #e0d9cc;">
      <p style="font-size:12px;color:#8a8070;margin:0;">Metaconception — Dessinateur-Concepteur en Architecture</p>
      <p style="font-size:12px;color:#8a8070;margin:4px 0 0;">Junas, 30250 Gard · contact@metaconception.eu</p>
      <p style="font-size:11px;color:#b0a898;margin:8px 0 0;">Données traitées conformément au RGPD · <a href="https://metaconception.eu/mentions-legales" style="color:#8a8070;">Mentions légales</a></p>
    </div>`;

  return `<div style="font-family:'Helvetica Neue',sans-serif;max-width:640px;margin:0 auto;color:#221e18;background:#fff;">
    ${header}
    ${intro}
    ${projetBlock}
    ${reglesBlock}
    ${surfacesBlock}
    ${recommandationBlock}
    ${disclaimer}
    ${footer}
  </div>`;
}

function buildReglesBlock(ai: AiAnalysisInfo): string {
  const parkingRow =
    ai.parkingNombrePlaces > 0
      ? `<tr><td style="padding:10px 12px;color:#8a8070;">Stationnement</td><td style="padding:10px 12px;font-weight:600;">${ai.parkingNombrePlaces} place(s) requise(s)</td></tr>`
      : "";

  return `
    <div style="margin:0 40px 24px;">
      <h2 style="font-size:13px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#8a8070;margin:0 0 12px;">Règles PLU applicables</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="background:#f5f0e6;"><td style="padding:10px 12px;color:#8a8070;">Retrait voie</td><td style="padding:10px 12px;font-weight:600;">${ai.retraitVoie} m min</td></tr>
        <tr><td style="padding:10px 12px;color:#8a8070;">Retrait latéral</td><td style="padding:10px 12px;font-weight:600;">${ai.retraitLateral} m min</td></tr>
        <tr style="background:#f5f0e6;"><td style="padding:10px 12px;color:#8a8070;">Retrait fond</td><td style="padding:10px 12px;font-weight:600;">${ai.retraitFond} m min</td></tr>
        <tr><td style="padding:10px 12px;color:#8a8070;">Emprise max</td><td style="padding:10px 12px;font-weight:600;">${ai.empriseNonReglementee ? "Non réglementée" : `${ai.empriseMax}%`}</td></tr>
        <tr style="background:#f5f0e6;"><td style="padding:10px 12px;color:#8a8070;">Hauteur max</td><td style="padding:10px 12px;font-weight:600;">${ai.hauteurMax} m</td></tr>
        ${parkingRow}
      </table>
    </div>`;
}

// ── Template email propriétaire ────────────────────────────────────────────

function buildOwnerEmailHtml(p: LeadPayload): string {
  const ai = p.aiAnalysis;

  const aiRows = ai
    ? `
      <tr><td style="padding:6px 8px;color:#8a8070;width:160px;">Retrait voie</td><td style="padding:6px 8px;">${ai.retraitVoie} m</td></tr>
      <tr style="background:#f5f0e6;"><td style="padding:6px 8px;color:#8a8070;">Retrait latéral</td><td style="padding:6px 8px;">${ai.retraitLateral} m</td></tr>
      <tr><td style="padding:6px 8px;color:#8a8070;">Retrait fond</td><td style="padding:6px 8px;">${ai.retraitFond} m</td></tr>
      <tr style="background:#f5f0e6;"><td style="padding:6px 8px;color:#8a8070;">Emprise max</td><td style="padding:6px 8px;">${ai.empriseNonReglementee ? "Non réglementée" : `${ai.empriseMax}%`}</td></tr>
      <tr><td style="padding:6px 8px;color:#8a8070;">Hauteur max</td><td style="padding:6px 8px;">${ai.hauteurMax} m</td></tr>
    `
    : `<tr><td colspan="2" style="padding:6px 8px;color:#8a8070;font-style:italic;">Aucune analyse IA disponible</td></tr>`;

  return `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;color:#221e18;">
      <h2 style="font-size:18px;font-weight:500;border-bottom:2px solid #b5651d;padding-bottom:10px;margin-bottom:20px;">
        Nouvelle demande PLU — ${p.nom} ${p.prenom}
      </h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;">
        <tr><td style="padding:6px 8px;color:#8a8070;width:160px;">Prénom</td><td style="padding:6px 8px;">${p.prenom}</td></tr>
        <tr style="background:#f5f0e6;"><td style="padding:6px 8px;color:#8a8070;">Nom</td><td style="padding:6px 8px;">${p.nom}</td></tr>
        <tr><td style="padding:6px 8px;color:#8a8070;">Email</td><td style="padding:6px 8px;"><a href="mailto:${p.email}">${p.email}</a></td></tr>
        <tr style="background:#f5f0e6;"><td style="padding:6px 8px;color:#8a8070;">Adresse projet</td><td style="padding:6px 8px;">${p.adresseProjet}</td></tr>
        <tr><td style="padding:6px 8px;color:#8a8070;">Commune</td><td style="padding:6px 8px;">${p.commune}</td></tr>
        <tr style="background:#f5f0e6;"><td style="padding:6px 8px;color:#8a8070;">Référence parcelle</td><td style="padding:6px 8px;">${p.parcelRef}</td></tr>
        <tr><td style="padding:6px 8px;color:#8a8070;">Surface parcelle</td><td style="padding:6px 8px;">${p.parcelSurface} m²</td></tr>
        <tr style="background:#f5f0e6;"><td style="padding:6px 8px;color:#8a8070;">Type de projet</td><td style="padding:6px 8px;">${p.projectTypeLabel}</td></tr>
        <tr><td style="padding:6px 8px;color:#8a8070;">Surface totale</td><td style="padding:6px 8px;">${p.totalM2} m² (${p.empriseP}%)</td></tr>
      </table>
      <h3 style="font-size:13px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#8a8070;margin:0 0 10px;">Règles PLU analysées</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
        ${aiRows}
      </table>
      <p style="font-size:11px;color:#8a8070;margin-top:20px;">Envoyé depuis metaconception.eu/plu</p>
    </div>`;
}

// ── Route POST ─────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  let payload: LeadPayload;

  try {
    payload = (await request.json()) as LeadPayload;
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide." }, { status: 400 });
  }

  const { prenom, nom, email, adresseProjet } = payload;
  if (!prenom || !nom || !email || !adresseProjet) {
    return NextResponse.json({ error: "Champs requis manquants." }, { status: 400 });
  }

  // Sauvegarde locale (silencieuse si Vercel)
  saveLeadToFile(payload as unknown as Record<string, unknown>);

  // Génération PDF (silencieuse si échec)
  let pdfBase64: string | null = null;
  try {
    const shapes = (payload.drawnShapesWithCoords ?? []).filter((s) => s.polygon && s.polygon.length >= 3);
    const pdfBytes = await generatePluPdf({
      prenom: payload.prenom,
      nom: payload.nom,
      adresseProjet: payload.adresseProjet,
      commune: payload.commune,
      parcelRef: payload.parcelRef,
      parcelSurface: payload.parcelSurface,
      projectTypeLabel: payload.projectTypeLabel,
      existingM2: payload.existingM2,
      drawnM2: payload.drawnM2,
      totalM2: payload.totalM2,
      empriseP: payload.empriseP,
      parcelRing: payload.parcelRing,
      zoneMain: payload.zoneMain ?? null,
      zoneAnnex: payload.zoneAnnex ?? null,
      drawnShapes: shapes,
      aiAnalysis: payload.aiAnalysis,
    });
    pdfBase64 = Buffer.from(pdfBytes).toString("base64");
  } catch (err) {
    console.error("[plu-leads] Erreur génération PDF:", err);
    // L'email sera envoyé sans pièce jointe
  }

  let hasError = false;

  // Email rapport à l'utilisateur
  try {
    await resend.emails.send({
      from: "Metaconception <contact@metaconception.eu>",
      to: email,
      subject: `Votre analyse PLU — ${adresseProjet}`,
      html: buildUserEmailHtml(payload),
      ...(pdfBase64
        ? {
            attachments: [
              {
                filename: "analyse-plu.pdf",
                content: pdfBase64,
              },
            ],
          }
        : {}),
    });
  } catch (err) {
    console.error("[plu-leads] Erreur email utilisateur:", err);
    hasError = true;
  }

  // Email notification au propriétaire
  try {
    await resend.emails.send({
      from: "Metaconception <contact@metaconception.eu>",
      to: process.env.CONTACT_EMAIL!,
      subject: `Nouvelle demande PLU — ${nom} ${prenom}`,
      html: buildOwnerEmailHtml(payload),
    });
  } catch (err) {
    console.error("[plu-leads] Erreur email propriétaire:", err);
    hasError = true;
  }

  if (hasError) {
    return NextResponse.json(
      { error: "Une erreur est survenue lors de l'envoi de l'email." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
