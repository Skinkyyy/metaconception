import { Resend } from "resend";
import { NextResponse } from "next/server";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: Request) {
  const { nom, email, telephone, typeProjet, message } = await request.json();

  if (!nom || !email || !message) {
    return NextResponse.json({ error: "Champs requis manquants." }, { status: 400 });
  }

  try {
    await resend.emails.send({
      from: "Metaconception <contact@metaconception.eu>",
      to: process.env.CONTACT_EMAIL!,
      replyTo: email,
      subject: `Nouveau message — ${typeProjet} (${nom})`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #221e18;">
          <h2 style="border-bottom: 2px solid #7a9478; padding-bottom: 12px;">
            Nouveau message de contact
          </h2>
          <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
            <tr>
              <td style="padding: 8px 0; color: #8a8070; width: 140px;">Nom</td>
              <td style="padding: 8px 0; font-weight: 600;">${nom}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #8a8070;">Email</td>
              <td style="padding: 8px 0;">${email}</td>
            </tr>
            ${telephone ? `
            <tr>
              <td style="padding: 8px 0; color: #8a8070;">Téléphone</td>
              <td style="padding: 8px 0;">${telephone}</td>
            </tr>` : ""}
            <tr>
              <td style="padding: 8px 0; color: #8a8070;">Type de projet</td>
              <td style="padding: 8px 0;">${typeProjet}</td>
            </tr>
          </table>
          <div style="margin-top: 24px; padding: 20px; background: #f5f0e6; border-left: 3px solid #7a9478;">
            <p style="margin: 0; white-space: pre-wrap;">${message}</p>
          </div>
          <p style="margin-top: 24px; color: #8a8070; font-size: 12px;">
            Envoyé depuis metaconception.eu
          </p>
        </div>
      `,
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Erreur lors de l'envoi." }, { status: 500 });
  }
}
