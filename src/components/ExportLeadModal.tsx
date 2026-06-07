"use client";

import { useState, useEffect, useRef } from "react";

interface Props {
  open: boolean;
  address: string;
  parcelId?: string;
  parcelSurface?: number;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

interface FormData {
  prenom: string;
  nom: string;
  email: string;
  lieu: string;
  description: string;
}

export default function ExportLeadModal({ open, address, parcelId, parcelSurface, onClose, onConfirm }: Props) {
  const [form, setForm] = useState<FormData>({ prenom: "", nom: "", email: "", lieu: address, description: "" });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  // Pré-remplir le lieu avec l'adresse quand le modal s'ouvre
  useEffect(() => {
    if (open) {
      setForm(f => ({ ...f, lieu: address }));
      setError(null);
      setTimeout(() => firstInputRef.current?.focus(), 50);
    }
  }, [open, address]);

  // Fermer avec Échap
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const set = (key: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.prenom.trim() || !form.nom.trim() || !form.email.trim()) {
      setError("Prénom, nom et e-mail sont obligatoires.");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(form.email)) {
      setError("Adresse e-mail invalide.");
      return;
    }

    setSending(true);
    setError(null);

    try {
      const res = await fetch("/api/export-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          address,
          parcelId,
          parcelSurface,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Erreur réseau");
      }
      // Email envoyé → générer le PDF
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(7,16,8)]/85 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md mx-4 rounded-2xl bg-[#0d1a10] border border-[#2d6a4f]/60 shadow-2xl overflow-hidden">

        {/* En-tête */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-[#2a3d2e]/60 bg-[#0a1508]">
          <div>
            <h2 className="text-[#c4a35a] text-sm font-bold tracking-wider uppercase">
              Étude de faisabilité
            </h2>
            <p className="text-[#5a7a5d] text-[11px] mt-0.5">
              Renseignez vos coordonnées pour recevoir le document
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#4a6a4d] hover:text-[#e8f0e9] transition-colors mt-0.5 text-lg leading-none"
            aria-label="Fermer"
          >
            ×
          </button>
        </div>

        {/* Formulaire */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">

          {/* Prénom + Nom */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[#7a9a7d] text-[10px] font-semibold uppercase tracking-widest mb-1.5">
                Prénom <span className="text-[#c4a35a]">*</span>
              </label>
              <input
                ref={firstInputRef}
                type="text"
                value={form.prenom}
                onChange={set("prenom")}
                placeholder="Jean"
                required
                className="w-full bg-[#111f14] border border-[#2a3d2e] hover:border-[#3d5a3f] focus:border-[#c4a35a] rounded-lg px-3 py-2 text-xs text-[#e8f0e9] placeholder-[#3a5a3d] outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-[#7a9a7d] text-[10px] font-semibold uppercase tracking-widest mb-1.5">
                Nom <span className="text-[#c4a35a]">*</span>
              </label>
              <input
                type="text"
                value={form.nom}
                onChange={set("nom")}
                placeholder="Dupont"
                required
                className="w-full bg-[#111f14] border border-[#2a3d2e] hover:border-[#3d5a3f] focus:border-[#c4a35a] rounded-lg px-3 py-2 text-xs text-[#e8f0e9] placeholder-[#3a5a3d] outline-none transition-colors"
              />
            </div>
          </div>

          {/* E-mail */}
          <div>
            <label className="block text-[#7a9a7d] text-[10px] font-semibold uppercase tracking-widest mb-1.5">
              Adresse e-mail <span className="text-[#c4a35a]">*</span>
            </label>
            <input
              type="email"
              value={form.email}
              onChange={set("email")}
              placeholder="jean.dupont@email.fr"
              required
              className="w-full bg-[#111f14] border border-[#2a3d2e] hover:border-[#3d5a3f] focus:border-[#c4a35a] rounded-lg px-3 py-2 text-xs text-[#e8f0e9] placeholder-[#3a5a3d] outline-none transition-colors"
            />
          </div>

          {/* Lieu du projet */}
          <div>
            <label className="block text-[#7a9a7d] text-[10px] font-semibold uppercase tracking-widest mb-1.5">
              Lieu du projet
            </label>
            <input
              type="text"
              value={form.lieu}
              onChange={set("lieu")}
              placeholder="Ville, département…"
              className="w-full bg-[#111f14] border border-[#2a3d2e] hover:border-[#3d5a3f] focus:border-[#c4a35a] rounded-lg px-3 py-2 text-xs text-[#e8f0e9] placeholder-[#3a5a3d] outline-none transition-colors"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-[#7a9a7d] text-[10px] font-semibold uppercase tracking-widest mb-1.5">
              Description du projet
            </label>
            <textarea
              value={form.description}
              onChange={set("description")}
              placeholder="Maison individuelle, extension, garage…"
              rows={3}
              className="w-full bg-[#111f14] border border-[#2a3d2e] hover:border-[#3d5a3f] focus:border-[#c4a35a] rounded-lg px-3 py-2 text-xs text-[#e8f0e9] placeholder-[#3a5a3d] outline-none transition-colors resize-none"
            />
          </div>

          {/* Erreur */}
          {error && (
            <p className="text-red-400 text-[11px] bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {/* Boutons */}
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={sending}
              className="flex-1 py-2 rounded-lg text-xs font-medium text-[#5a7a5d] border border-[#2a3d2e] hover:border-[#3d5a3f] hover:text-[#a8bfaa] transition-colors disabled:opacity-40"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={sending}
              className="flex-1 py-2 rounded-lg text-xs font-semibold bg-[#c4a35a] hover:bg-[#d4b36a] text-[#0d1a10] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {sending ? (
                <>
                  <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25"/>
                    <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                  </svg>
                  Envoi…
                </>
              ) : "Générer l'étude →"}
            </button>
          </div>

          <p className="text-[#3a5a3d] text-[10px] text-center">
            Vos coordonnées sont utilisées uniquement pour le suivi de votre projet.
          </p>
        </form>
      </div>
    </div>
  );
}
