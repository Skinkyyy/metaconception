import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY non configurée" }, { status: 500 });
    }

    const formData = await req.formData();
    const planLotFile = formData.get("planLot") as File | null;
    const ccapFile = formData.get("ccap") as File | null;

    if (!planLotFile && !ccapFile) {
      return NextResponse.json({ error: "Aucun fichier fourni" }, { status: 400 });
    }

    const prompt = `Tu es un expert en droit de l'urbanisme français spécialisé dans les lotissements.

Analyse le ou les documents fournis. Il peut s'agir :
- d'un plan de division / plan de lot (géomètre-expert, plan cadastral de division)
- d'un CPAP — Cahier des Prescriptions Architecturales et Paysagères
- d'un CCAP — Cahier des Clauses Architecturales et Paysagères
- ou des deux à la fois

Rappel important : dans un lotissement, le CPAP/CCAP impose des règles souvent plus restrictives que le PLU communal. Ce sont toujours les règles les plus restrictives qui s'appliquent. Certains lotissements sont soumis au RNU (Règlement National d'Urbanisme) si la commune n'a pas de PLU — le CPAP est alors le seul règlement applicable.

Pour le plan de lot / plan de division :
- Identifie la surface de chaque lot (en m²) et ses dimensions cotées
- Repère les zones non aedificandi ou zones inconstructibles éventuelles
- Note les emplacements réservés au stationnement ou à la voirie interne
- Identifie les marges de recul déjà matérialisées graphiquement

Pour le CPAP / CCAP :
- Extrais les retraits imposés (voie publique, limites séparatives latérales, fond de parcelle) en mètres — si non précisé, mettre -1
- Extrais l'emprise au sol maximale en % — si le document impose une proportion d'espaces non imperméabilisés (ex. "50% minimum en pleine terre"), convertis-la en emprise max (ex. 50% non imperméabilisé → empriseMax = 50)
- Extrais la hauteur maximale en mètres — si définie par un nombre de niveaux (R+0, R+1…), convertis en mètres approximatifs (R+0 = 3-4m, R+1 = 6-7m)
- Extrais les règles de stationnement : nombre de places minimum, accès voirie exigé ou non
- Extrais les règles architecturales détaillées : matériaux de façade, couleurs (références RAL ou nuancier), type de toiture et pente, matériaux de couverture, clôtures (hauteur, matériaux, couleur), portails
- Note les interdictions spécifiques (éléments décoratifs proscrits, végétaux interdits, matériaux interdits, essences de cyprès…)
- Note les obligations spécifiques (haies végétales, type d'enduit, palette de teintes imposée, avis architecte coordonnateur, béton balayé…)
- Si un architecte coordonnateur est mentionné, note-le dans autresRegles

Pour les valeurs numériques non trouvées dans les documents, utilise -1 (signifiant "non précisé dans le document").
Pour parkingOuvertSurVoirie : true si le document exige explicitement un accès depuis la voirie, false sinon.

Le champ "avertissement" doit être : "L'analyse est basée sur les documents fournis. Consultez le géomètre ou le notaire du lotissement pour les règles exactes applicables à votre lot."`;

    const parts: Record<string, unknown>[] = [{ text: prompt }];

    if (planLotFile) {
      const bytes = await planLotFile.arrayBuffer();
      const base64 = Buffer.from(bytes).toString("base64");
      parts.push({
        inlineData: {
          mimeType: planLotFile.type || "application/pdf",
          data: base64,
        },
      });
    }

    if (ccapFile) {
      const bytes = await ccapFile.arrayBuffer();
      const base64 = Buffer.from(bytes).toString("base64");
      parts.push({
        inlineData: {
          mimeType: ccapFile.type || "application/pdf",
          data: base64,
        },
      });
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                resume: {
                  type: "STRING",
                  description: "Résumé de 2-3 phrases sur les règles trouvées dans les documents",
                },
                retraitVoie: {
                  type: "NUMBER",
                  description: "Retrait par rapport à la voie en mètres, ou -1 si non précisé",
                },
                retraitLateral: {
                  type: "NUMBER",
                  description: "Retrait latéral en mètres, ou -1 si non précisé",
                },
                retraitFond: {
                  type: "NUMBER",
                  description: "Retrait fond de parcelle en mètres, ou -1 si non précisé",
                },
                empriseMax: {
                  type: "NUMBER",
                  description: "Emprise au sol maximale en %, ou -1 si non précisé",
                },
                hauteurMax: {
                  type: "NUMBER",
                  description: "Hauteur maximale en mètres, ou -1 si non précisé",
                },
                parkingNombrePlaces: {
                  type: "NUMBER",
                  description: "Nombre minimum de places de stationnement requises, ou -1 si non précisé",
                },
                parkingOuvertSurVoirie: {
                  type: "BOOLEAN",
                  description: "True si le document exige un accès direct depuis la voirie",
                },
                parkingDetails: {
                  type: "STRING",
                  description: "Précisions sur les règles de stationnement du lotissement",
                },
                reglesArchitecturales: {
                  type: "ARRAY",
                  items: { type: "STRING" },
                  description: "Liste des règles architecturales (matériaux, couleurs, toiture, clôtures…)",
                },
                autresRegles: {
                  type: "ARRAY",
                  items: { type: "STRING" },
                  description: "Autres règles ou interdictions spécifiques au lotissement",
                },
                avertissement: {
                  type: "STRING",
                },
              },
              required: [
                "resume",
                "retraitVoie",
                "retraitLateral",
                "retraitFond",
                "empriseMax",
                "hauteurMax",
                "parkingNombrePlaces",
                "parkingOuvertSurVoirie",
                "parkingDetails",
                "reglesArchitecturales",
                "autresRegles",
                "avertissement",
              ],
            },
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini lotissement error:", errText);
      return NextResponse.json({ error: "Erreur API Gemini" }, { status: 502 });
    }

    const geminiData = await geminiRes.json();
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return NextResponse.json({ error: "Réponse vide" }, { status: 502 });

    const analysis = JSON.parse(text);
    return NextResponse.json(analysis);
  } catch (err) {
    console.error("lotissement-analysis error:", err);
    return NextResponse.json({ error: "Erreur interne" }, { status: 500 });
  }
}
