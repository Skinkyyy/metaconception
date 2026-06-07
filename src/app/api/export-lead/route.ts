import { Resend } from "resend";
import { NextResponse } from "next/server";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: Request) {
  const { prenom, nom, email, description, lieu, parcelId, parcelSurface, address } =
    await request.json();

  if (!prenom || !nom || !email) {
    return NextResponse.json({ error: "Champs requis manquants." }, { status: 400 });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return NextResponse.json({ error: "Adresse e-mail invalide." }, { status: 400 });
  }

  try {
    await resend.emails.send({
      from: "Metaconception <contact@metaconception.eu>",
      to: process.env.CONTACT_EMAIL ?? "corrado.palma@gmail.com",
      replyTo: email,
      subject: `Nouvelle demande d'étude — ${prenom} ${nom}${lieu ? ` — ${lieu}` : ""}`,
      html: `
        <div style="font-family: sans-serif; max-width: 620px; margin: 0 auto; color: #1a1a1a; background: #fff;">
          <div style="background: #0d1a10; padding: 28px 32px 20px;">
            <h2 style="margin: 0; color: #c4a35a; font-size: 18px; letter-spacing: 0.05em;">
              NOUVELLE DEMANDE D'ÉTUDE DE FAISABILITÉ
            </h2>
            <p style="margin: 6px 0 0; color: #6a9a6d; font-size: 12px;">
              via l'outil metaconception.eu
            </p>
          </div>

          <div style="padding: 28px 32px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #e8e8e8; color: #777; width: 160px; font-size: 13px;">Prénom</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #e8e8e8; font-weight: 600; font-size: 13px;">${prenom}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #e8e8e8; color: #777; font-size: 13px;">Nom</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #e8e8e8; font-weight: 600; font-size: 13px;">${nom}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #e8e8e8; color: #777; font-size: 13px;">E-mail</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #e8e8e8; font-size: 13px;">
                  <a href="mailto:${email}" style="color: #2d6a4f;">${email}</a>
                </td>
              </tr>
              ${lieu ? `
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #e8e8e8; color: #777; font-size: 13px;">Lieu du projet</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #e8e8e8; font-size: 13px;">${lieu}</td>
              </tr>` : ""}
              ${address && address !== lieu ? `
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #e8e8e8; color: #777; font-size: 13px;">Adresse (outil)</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #e8e8e8; font-size: 13px;">${address}</td>
              </tr>` : ""}
              ${parcelId ? `
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #e8e8e8; color: #777; font-size: 13px;">Parcelle</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #e8e8e8; font-size: 13px;">
                  ${parcelId}${parcelSurface ? ` · ${Math.round(parcelSurface)} m²` : ""}
                </td>
              </tr>` : ""}
            </table>

            ${description ? `
            <div style="margin-top: 24px;">
              <p style="margin: 0 0 10px; color: #777; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em;">Description du projet</p>
              <div style="background: #f7f9f7; border-left: 3px solid #2d6a4f; padding: 16px 20px; border-radius: 0 6px 6px 0;">
                <p style="margin: 0; white-space: pre-wrap; font-size: 13px; line-height: 1.6; color: #2a2a2a;">${description}</p>
              </div>
            </div>` : ""}
          </div>

          <div style="padding: 16px 32px; background: #f7f9f7; border-top: 1px solid #e8e8e8;">
            <p style="margin: 0; color: #aaa; font-size: 11px;">
              Demande générée depuis metaconception.eu — ${new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
        </div>
      `,
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Erreur lors de l'envoi." }, { status: 500 });
  }
}
