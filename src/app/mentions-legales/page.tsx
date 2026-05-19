import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mentions légales",
  description:
    "Mentions légales du site Metaconception — éditeur, hébergement, données personnelles et cookies.",
  robots: { index: false, follow: false },
};

export default function MentionsLegalesPage() {
  return (
    <main className="min-h-screen bg-white pt-28 pb-20 px-6">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-light text-[#221e18] mb-10 tracking-wide">
          Mentions légales
        </h1>

        {/* Éditeur */}
        <section className="mb-10">
          <h2 className="text-xs font-semibold tracking-[0.2em] uppercase text-[#8a8070] mb-4">
            Éditeur du site
          </h2>
          <div className="space-y-1.5 text-sm text-[#221e18] leading-relaxed">
            <p>
              <strong>Corrado Palma</strong> — Auto-entrepreneur
            </p>
            <p>SIRET : [80508229400028]</p>
            <p>Adresse : Junas, 30250, Gard, France</p>
            <p>
              Email :{" "}
              <a
                href="mailto:contact@metaconception.eu"
                className="text-[#b5651d] hover:underline"
              >
                contact@metaconception.eu
              </a>
            </p>
            <p>Site : metaconception.eu</p>
          </div>
        </section>

        <hr className="border-[#e8e2d9] mb-10" />

        {/* Hébergement */}
        <section className="mb-10">
          <h2 className="text-xs font-semibold tracking-[0.2em] uppercase text-[#8a8070] mb-4">
            Hébergement
          </h2>
          <div className="text-sm text-[#221e18] leading-relaxed space-y-1.5">
            <p>
              <strong>Vercel Inc.</strong>
            </p>
            <p>440 N Barranca Ave #4133, Covina, CA 91723, USA</p>
            <p>
              Site :{" "}
              <a
                href="https://vercel.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#b5651d] hover:underline"
              >
                vercel.com
              </a>
            </p>
          </div>
        </section>

        <hr className="border-[#e8e2d9] mb-10" />

        {/* Données personnelles */}
        <section className="mb-10">
          <h2 className="text-xs font-semibold tracking-[0.2em] uppercase text-[#8a8070] mb-4">
            Données personnelles
          </h2>
          <div className="text-sm text-[#221e18] leading-relaxed space-y-3">
            <p>
              Les données collectées via les formulaires du site (nom, prénom,
              adresse email, adresse du projet) sont utilisées exclusivement pour
              le traitement des demandes d&apos;analyse PLU et l&apos;envoi du rapport
              associé.
            </p>
            <p>
              Ces données ne sont pas transmises à des tiers et ne font l&apos;objet
              d&apos;aucune utilisation commerciale.
            </p>
            <p>
              <strong>Durée de conservation :</strong> 2 ans à compter de la
              collecte.
            </p>
            <p>
              Conformément au Règlement Général sur la Protection des Données
              (RGPD — Règlement UE 2016/679), vous disposez d&apos;un droit d&apos;accès,
              de rectification et de suppression de vos données. Pour exercer ces
              droits, contactez-nous à :{" "}
              <a
                href="mailto:contact@metaconception.eu"
                className="text-[#b5651d] hover:underline"
              >
                contact@metaconception.eu
              </a>
            </p>
          </div>
        </section>

        <hr className="border-[#e8e2d9] mb-10" />

        {/* Cookies */}
        <section className="mb-10">
          <h2 className="text-xs font-semibold tracking-[0.2em] uppercase text-[#8a8070] mb-4">
            Cookies
          </h2>
          <div className="text-sm text-[#221e18] leading-relaxed space-y-3">
            <p>
              Ce site utilise uniquement des cookies techniques strictement
              nécessaires à son bon fonctionnement (session Next.js).
            </p>
            <p>
              Aucun cookie publicitaire, de suivi comportemental ni d&apos;outil
              analytique tiers n&apos;est déposé sur votre navigateur.
            </p>
          </div>
        </section>

        <hr className="border-[#e8e2d9] mb-10" />

        {/* Propriété intellectuelle */}
        <section className="mb-10">
          <h2 className="text-xs font-semibold tracking-[0.2em] uppercase text-[#8a8070] mb-4">
            Propriété intellectuelle
          </h2>
          <div className="text-sm text-[#221e18] leading-relaxed">
            <p>
              L&apos;ensemble des contenus présents sur ce site (textes, images,
              illustrations, plans, modélisations 3D, logos) sont protégés par le
              droit d&apos;auteur et appartiennent à Corrado Palma.
            </p>
            <p className="mt-2">
              © 2024-2026 Corrado Palma — Metaconception. Tous droits réservés.
              Toute reproduction, même partielle, est interdite sans autorisation
              écrite préalable.
            </p>
          </div>
        </section>

        <hr className="border-[#e8e2d9] mb-10" />

        {/* Retour */}
        <div className="mt-6">
          <a
            href="/"
            className="text-xs text-[#8a8070] hover:text-[#221e18] transition-colors tracking-wide underline"
          >
            ← Retour à l&apos;accueil
          </a>
        </div>
      </div>
    </main>
  );
}
