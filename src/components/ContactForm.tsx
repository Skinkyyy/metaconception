"use client";

import { useState } from "react";

const TYPES_PROJET = [
  "Maison individuelle",
  "Extension",
  "Rénovation",
  "Aménagement",
  "Opérations immobilières",
  "Autre",
];

type Status = "idle" | "loading" | "success" | "error";

export default function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [form, setForm] = useState({
    nom: "",
    email: "",
    telephone: "",
    typeProjet: "",
    message: "",
  });

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (res.ok) {
        setStatus("success");
        setForm({ nom: "", email: "", telephone: "", typeProjet: "", message: "" });
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  const inputClass =
    "w-full bg-transparent border-b border-warm-gray/40 py-3 text-warm-white placeholder:text-muted/50 focus:outline-none focus:border-terracotta transition-colors duration-200 text-sm";

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Nom + Email */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
        <div>
          <input
            type="text"
            name="nom"
            placeholder="Nom complet *"
            required
            value={form.nom}
            onChange={handleChange}
            className={inputClass}
          />
        </div>
        <div>
          <input
            type="email"
            name="email"
            placeholder="Email *"
            required
            value={form.email}
            onChange={handleChange}
            className={inputClass}
          />
        </div>
      </div>

      {/* Téléphone + Type de projet */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
        <div>
          <input
            type="tel"
            name="telephone"
            placeholder="Téléphone"
            value={form.telephone}
            onChange={handleChange}
            className={inputClass}
          />
        </div>
        <div>
          <select
            name="typeProjet"
            required
            value={form.typeProjet}
            onChange={handleChange}
            className={`${inputClass} cursor-pointer`}
          >
            <option value="" disabled className="bg-anthracite text-muted">
              Type de projet *
            </option>
            {TYPES_PROJET.map((t) => (
              <option key={t} value={t} className="bg-anthracite text-warm-white">
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Message */}
      <div>
        <textarea
          name="message"
          placeholder="Décrivez votre projet *"
          required
          rows={5}
          value={form.message}
          onChange={handleChange}
          className={`${inputClass} resize-none`}
        />
      </div>

      {/* RGPD */}
      <p className="text-muted/50 text-[11px] leading-relaxed">
        Les informations saisies sont utilisées uniquement pour répondre à votre demande.
        Conformément au RGPD, vous disposez d&apos;un droit d&apos;accès, de rectification
        et de suppression de vos données en nous contactant par email.
      </p>

      {/* Submit */}
      <div className="flex items-center gap-6">
        <button
          type="submit"
          disabled={status === "loading"}
          className="bg-terracotta text-white px-10 py-4 text-[11px] tracking-[0.22em] uppercase font-medium hover:bg-terracotta-dark transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {status === "loading" ? "Envoi en cours…" : "Envoyer le message"}
        </button>

        {status === "success" && (
          <p className="text-terracotta-light text-sm">
            Message envoyé — je vous réponds sous 48h.
          </p>
        )}
        {status === "error" && (
          <p className="text-red-400 text-sm">
            Une erreur est survenue, réessayez.
          </p>
        )}
      </div>
    </form>
  );
}
