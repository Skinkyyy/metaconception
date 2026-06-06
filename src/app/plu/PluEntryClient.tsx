"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Suggestion {
  label: string;
  lat: number;
  lon: number;
}

export default function PluEntryClient() {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [error, setError] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setSuggestions([]);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function handleInputChange(value: string) {
    setAddress(value);
    setError("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 3) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      setLoadingSuggestions(true);
      try {
        const res = await fetch(
          `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(value)}&limit=5`,
        );
        const data = await res.json();
        const results: Suggestion[] = (data.features ?? []).map(
          (f: { properties: { label: string }; geometry: { coordinates: [number, number] } }) => ({
            label: f.properties.label,
            lon: f.geometry.coordinates[0],
            lat: f.geometry.coordinates[1],
          }),
        );
        setSuggestions(results);
      } catch {
        setSuggestions([]);
      } finally {
        setLoadingSuggestions(false);
      }
    }, 250);
  }

  function handleSelect(s: Suggestion) {
    setAddress(s.label);
    setSuggestions([]);
    router.push(`/plan?lat=${s.lat}&lon=${s.lon}&address=${encodeURIComponent(s.label)}`);
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!address.trim()) return;
    if (suggestions.length > 0) { handleSelect(suggestions[0]); return; }
    setError("");
    try {
      const res = await fetch(
        `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(address)}&limit=1`,
      );
      const data = await res.json();
      const feat = data.features?.[0];
      if (!feat) { setError("Adresse introuvable."); return; }
      const [lon, lat] = feat.geometry.coordinates;
      router.push(`/plan?lat=${lat}&lon=${lon}&address=${encodeURIComponent(feat.properties.label)}`);
    } catch {
      setError("Erreur de connexion. Vérifiez votre réseau.");
    }
  }

  return (
    <main className="min-h-screen bg-[#0d1a10] flex flex-col items-center justify-center px-4">

      {/* Titre */}
      <div className="mb-10 text-center">
        <p className="text-[#5a7a5d] text-sm">Plan de masse coté · Conformité PLU · Export PDF</p>
      </div>

      {/* Search card */}
      <div className="w-full max-w-lg bg-[#142018] rounded-xl p-8 shadow-2xl border border-[#2a3d2e]">
        <h1 className="text-[#e8f0e9] text-xl font-semibold mb-1">Démarrer un plan de masse</h1>
        <p className="text-[#7a9a7d] text-sm mb-6">
          Entrez l&apos;adresse de votre projet pour charger la parcelle cadastrale.
        </p>

        <form onSubmit={handleSearch} className="flex flex-col gap-3">
          <div ref={containerRef} className="relative">
            <input
              type="text"
              value={address}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setSuggestions([]); }}
              placeholder="Ex : 12 rue des Lilas, 75011 Paris"
              className="w-full bg-[#0a1209] text-[#e8f0e9] placeholder-[#4a6a4d] border border-[#2a3d2e] rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-[#2d6a4f] focus:ring-1 focus:ring-[#2d6a4f] transition"
              autoComplete="off"
            />

            {/* Suggestions */}
            {suggestions.length > 0 && (
              <ul className="absolute top-full left-0 right-0 mt-1 bg-[#142018] border border-[#2a3d2e] rounded-lg shadow-xl z-50 overflow-hidden">
                {suggestions.map((s, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); handleSelect(s); }}
                      className="w-full text-left px-4 py-2.5 text-sm text-[#a8bfaa] hover:bg-[#1c2e1f] transition-colors flex items-center gap-2"
                    >
                      <span className="text-[#5a7a5d] text-xs shrink-0">📍</span>
                      {s.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {loadingSuggestions && address.length >= 3 && suggestions.length === 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-[#142018] border border-[#2a3d2e] rounded-lg px-4 py-2.5 text-[#5a7a5d] text-sm">
                Recherche…
              </div>
            )}
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <button
            type="submit"
            disabled={!address.trim()}
            className="w-full bg-[#2d6a4f] hover:bg-[#3a7a5f] disabled:opacity-40 disabled:cursor-not-allowed text-[#e8f0e9] font-semibold py-3 px-6 rounded-lg text-sm transition-colors"
          >
            Ouvrir dans le plan de masse →
          </button>
        </form>
      </div>

      {/* Features */}
      <div className="mt-10 grid grid-cols-3 gap-4 max-w-lg w-full">
        {[
          { icon: "⊞", label: "Sélection parcelle cadastrale" },
          { icon: "⟂", label: "Snap & cotations automatiques" },
          { icon: "✓", label: "Vérification conformité PLU" },
        ].map((f) => (
          <div key={f.label} className="bg-[#142018]/60 rounded-lg p-3 text-center border border-[#2a3d2e]/40">
            <div className="text-xl mb-1 text-[#7a9a7d]">{f.icon}</div>
            <p className="text-[#5a7a5d] text-[11px] leading-tight">{f.label}</p>
          </div>
        ))}
      </div>

      <p className="mt-8 text-[#3a5a3d] text-xs">
        Outil bêta · Résultats indicatifs, ne constituent pas un avis juridique
      </p>
    </main>
  );
}
