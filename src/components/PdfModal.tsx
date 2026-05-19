"use client";

import { useState } from "react";
import Link from "next/link";

interface DrawnShapeInfo {
  label: string;
  type: string;
  surfaceM2: number;
  niveaux?: string;
}

interface DrawnShapeWithCoords {
  label: string;
  type: string;
  surfaceM2: number;
  niveaux?: string;
  polygon: [number, number][]; // [lat, lon][]
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

interface PdfModalProps {
  open: boolean;
  onClose: () => void;
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
  drawnShapesWithCoords?: DrawnShapeWithCoords[];
}

export default function PdfModal({
  open,
  onClose,
  adresseProjet,
  commune,
  parcelRef,
  parcelSurface,
  projectTypeLabel,
  existingM2,
  drawnM2,
  totalM2,
  empriseP,
  drawnShapes,
  aiAnalysis,
  parcelRing,
  zoneMain,
  zoneAnnex,
  drawnShapesWithCoords,
}: PdfModalProps) {
  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [email, setEmail] = useState("");
  const [adresse, setAdresse] = useState(adresseProjet);
  const [rgpd, setRgpd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const canSubmit =
    prenom.trim() !== "" &&
    nom.trim() !== "" &&
    email.trim() !== "" &&
    rgpd &&
    !loading;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setLoading(true);
    setError(null);

    try {
      const body = {
        prenom: prenom.trim(),
        nom: nom.trim(),
        email: email.trim(),
        adresseProjet: adresse.trim(),
        commune,
        parcelRef,
        parcelSurface,
        projectTypeLabel,
        existingM2,
        drawnM2,
        totalM2,
        empriseP,
        drawnShapes,
        aiAnalysis,
        parcelRing,
        zoneMain,
        zoneAnnex,
        drawnShapesWithCoords,
      };

      const res = await fetch("/api/plu-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Erreur inconnue");
      }

      setSuccess(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Une erreur est survenue. Veuillez réessayer."
      );
    } finally {
      setLoading(false);
    }
  }

  function handleOverlayClick() {
    if (!loading) onClose();
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[9999] flex items-center justify-center p-4"
      onClick={handleOverlayClick}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Bouton fermer */}
        {!loading && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 text-[#8a8070] hover:text-[#221e18] transition-colors text-lg leading-none"
            aria-label="Fermer"
          >
            ✕
          </button>
        )}

        {success ? (
          /* État succès */
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
              <span className="text-emerald-600 text-2xl">✓</span>
            </div>
            <div>
              <p className="font-semibold text-[#221e18] text-base">Rapport envoyé !</p>
              <p className="text-sm text-[#8a8070] mt-1">Vérifiez votre boîte email.</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 w-full bg-[#b5651d] text-white text-xs font-semibold tracking-[0.2em] uppercase px-6 py-3 hover:bg-[#9e5518] transition-colors rounded-lg"
            >
              Fermer
            </button>
          </div>
        ) : (
          /* Formulaire */
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-[#221e18]">
                Recevoir le rapport par email
              </h2>
              <p className="text-sm text-[#8a8070] mt-1">
                Un résumé de votre analyse PLU sera envoyé à votre adresse email.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[#8a8070] mb-1 font-medium">
                  Prénom <span className="text-[#b5651d]">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={prenom}
                  onChange={(e) => setPrenom(e.target.value)}
                  className="w-full border border-[#e0d9cc] px-3 py-2 text-sm text-[#221e18] focus:outline-none focus:border-[#b5651d] rounded"
                  placeholder="Prénom"
                />
              </div>
              <div>
                <label className="block text-xs text-[#8a8070] mb-1 font-medium">
                  Nom <span className="text-[#b5651d]">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={nom}
                  onChange={(e) => setNom(e.target.value)}
                  className="w-full border border-[#e0d9cc] px-3 py-2 text-sm text-[#221e18] focus:outline-none focus:border-[#b5651d] rounded"
                  placeholder="Nom"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-[#8a8070] mb-1 font-medium">
                Email <span className="text-[#b5651d]">*</span>
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-[#e0d9cc] px-3 py-2 text-sm text-[#221e18] focus:outline-none focus:border-[#b5651d] rounded"
                placeholder="votre@email.fr"
              />
            </div>

            <div>
              <label className="block text-xs text-[#8a8070] mb-1 font-medium">
                Adresse du projet
              </label>
              <input
                type="text"
                value={adresse}
                onChange={(e) => setAdresse(e.target.value)}
                className="w-full border border-[#e0d9cc] px-3 py-2 text-sm text-[#221e18] focus:outline-none focus:border-[#b5651d] rounded"
                placeholder="Adresse du projet"
              />
            </div>

            {/* RGPD */}
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={rgpd}
                onChange={(e) => setRgpd(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[#b5651d] shrink-0"
              />
              <span className="text-xs text-[#5a5246] leading-relaxed">
                J&apos;accepte que mes données soient utilisées pour traiter ma demande
                (conformément aux{" "}
                <Link
                  href="/mentions-legales"
                  target="_blank"
                  className="underline hover:text-[#221e18]"
                >
                  mentions légales
                </Link>
                ).
              </span>
            </label>

            {/* Erreur */}
            {error && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded">
                {error}
              </p>
            )}

            {/* Bouton submit */}
            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full bg-[#b5651d] text-white text-xs font-semibold tracking-[0.2em] uppercase px-6 py-3 hover:bg-[#9e5518] transition-colors disabled:opacity-40 disabled:cursor-not-allowed rounded-lg flex items-center justify-center gap-2"
            >
              {loading && (
                <svg
                  className="animate-spin h-4 w-4 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              )}
              {loading ? "Envoi en cours…" : "Envoyer le rapport"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
