import Image from "next/image";
import ContactForm from "@/components/ContactForm";

// ─── SVG ICONS ───────────────────────────────────────────────────────────────

function IconConception() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 28V13L15 3l13 10v15" />
      <rect x="10" y="19" width="10" height="9" />
      <line x1="2" y1="19" x2="10" y2="19" strokeOpacity="0.4" />
      <line x1="20" y1="19" x2="28" y2="19" strokeOpacity="0.4" />
    </svg>
  );
}

function IconDossiers() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3h12l5 5v19H7V3z" />
      <path d="M19 3v5h5" strokeOpacity="0.6" />
      <line x1="11" y1="13" x2="22" y2="13" />
      <line x1="11" y1="17" x2="22" y2="17" />
      <line x1="11" y1="21" x2="17" y2="21" />
    </svg>
  );
}

function IconPlans() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="26" height="26" />
      <line x1="2" y1="11" x2="28" y2="11" strokeOpacity="0.5" />
      <line x1="11" y1="2" x2="11" y2="28" strokeOpacity="0.5" />
      <polyline points="15,11 15,20 24,20" strokeWidth="1.8" />
      <circle cx="15" cy="11" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconReleves() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 22 Q7 8 15 13 Q23 18 28 6" />
      <path d="M2 27 Q8 18 15 21 Q22 24 28 14" strokeOpacity="0.5" />
      <line x1="2" y1="28" x2="28" y2="28" strokeOpacity="0.3" />
      <circle cx="15" cy="13" r="1.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconModelisation() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 2 L28 9v12L15 28 2 21V9z" />
      <line x1="15" y1="2" x2="15" y2="28" strokeOpacity="0.35" />
      <line x1="2" y1="9" x2="28" y2="9" strokeOpacity="0.35" />
      <line x1="2" y1="21" x2="28" y2="21" strokeOpacity="0.35" />
    </svg>
  );
}

function IconConseils() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4h24v17H17l-6 6v-6H3V4z" />
      <line x1="9" y1="11" x2="21" y2="11" />
      <line x1="9" y1="16" x2="16" y2="16" />
    </svg>
  );
}

// ─── SERVICES DATA ────────────────────────────────────────────────────────────

const services = [
  {
    Icon: IconConception,
    title: "Conception architecturale",
    description:
      "De l'esquisse au projet finalisé : une approche créative et rigoureuse pour concevoir des espaces qui répondent à vos besoins et à vos envies.",
  },
  {
    Icon: IconDossiers,
    title: "Dossiers administratifs",
    description:
      "Permis de construire, déclaration préalable, notices descriptives — je gère l'ensemble de vos démarches auprès des services d'urbanisme.",
  },
  {
    Icon: IconPlans,
    title: "Plans architecturaux",
    description:
      "Plans de masse, de coupe, de façade et d'exécution : tous les documents graphiques nécessaires à la réalisation de votre projet.",
  },
  {
    Icon: IconReleves,
    title: "Relevés topographiques",
    description:
      "Mesure et représentation précise du terrain et des bâtiments existants pour établir une base solide à chaque nouveau projet.",
  },
  {
    Icon: IconModelisation,
    title: "Modélisation 3D",
    description:
      "Visualisation réaliste de votre projet en trois dimensions pour percevoir le rendu final avant même le début des travaux.",
  },
  {
    Icon: IconConseils,
    title: "Conseils & accompagnement",
    description:
      "Un suivi personnalisé de la faisabilité à la livraison, avec un interlocuteur unique, disponible et engagé à chaque étape.",
  },
];

// ─── SECTIONS ─────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section
      id="hero"
      className="relative min-h-screen bg-anthracite flex flex-col justify-center overflow-hidden"
    >
      {/* Watermark letter */}
      <span
        aria-hidden="true"
        className="absolute right-0 bottom-0 select-none text-[48vw] font-bold leading-none text-white/[0.025] pointer-events-none"
      >
        M
      </span>

      {/* Left accent bar */}
      <div className="absolute left-0 top-1/4 bottom-1/4 w-px bg-terracotta/35" />

      <div className="relative max-w-6xl mx-auto px-8 sm:px-12 lg:px-16 w-full pt-28 pb-16">
        {/* Eyebrow */}
        <p className="text-terracotta text-[10px] font-medium tracking-[0.28em] uppercase mb-10">
          Dessinateur · Concepteur en Architecture
        </p>

        {/* Headline */}
        <h1 className="text-warm-white font-extralight text-5xl sm:text-6xl md:text-7xl lg:text-[5.5rem] leading-[1.06] mb-8 max-w-4xl">
          Dessiner l&apos;espace.
          <br />
          <span className="font-semibold">Construire</span> l&apos;avenir.
        </h1>

        {/* Divider */}
        <div className="w-14 h-px bg-terracotta mb-9" />

        {/* Sub-text */}
        <p className="text-muted text-base sm:text-lg leading-relaxed max-w-xl mb-14">
          15 ans d&apos;expérience en conception architecturale au service de vos
          projets. De l&apos;idée au permis de construire, un accompagnement
          rigoureux et personnalisé.
        </p>

        {/* CTAs */}
        <div className="flex flex-wrap gap-4">
          <a
            href="#services"
            className="inline-block bg-terracotta text-white text-[10px] font-semibold tracking-[0.2em] uppercase px-8 py-4 hover:bg-terracotta-dark transition-colors duration-200"
          >
            Nos services
          </a>
          <a
            href="#contact"
            className="inline-block border border-warm-white/20 text-warm-white text-[10px] font-semibold tracking-[0.2em] uppercase px-8 py-4 hover:border-warm-white/45 hover:bg-white/5 transition-all duration-200"
          >
            Nous contacter
          </a>
        </div>
      </div>

      {/* Scroll hint */}
      <div className="relative max-w-6xl mx-auto px-8 sm:px-12 lg:px-16 w-full pb-10 flex items-center gap-3">
        <div className="w-6 h-px bg-muted/40" />
        <span className="text-muted/45 text-[9px] tracking-[0.25em] uppercase">Découvrir</span>
      </div>
    </section>
  );
}

function Services() {
  return (
    <section id="services" className="bg-warm-white py-28 px-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-16">
          <p className="text-terracotta text-[10px] font-medium tracking-[0.28em] uppercase mb-4">
            Ce que je propose
          </p>
          <h2 className="text-anthracite text-4xl md:text-5xl font-light">
            Mes services
          </h2>
          <div className="w-14 h-px bg-terracotta mt-6" />
        </div>

        {/* Grid — 1px gaps via parent background trick */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-warm-gray">
          {services.map(({ Icon, title, description }) => (
            <div
              key={title}
              className="group bg-warm-white p-9 hover:bg-anthracite transition-colors duration-300 cursor-default"
            >
              <div className="text-terracotta mb-6 group-hover:text-terracotta-light transition-colors duration-300">
                <Icon />
              </div>
              <h3 className="text-anthracite group-hover:text-warm-white text-base font-semibold mb-3 transition-colors duration-300 leading-snug">
                {title}
              </h3>
              <p className="text-muted group-hover:text-warm-gray/60 text-sm leading-relaxed transition-colors duration-300">
                {description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const pluUseCases = [
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.4} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    title: "Faisabilité en quelques minutes",
    description:
      "Avant même de contacter un professionnel, vérifiez si votre projet est réalisable sur votre terrain : surface constructible disponible, hauteur autorisée, emprise au sol.",
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.4} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    ),
    title: "Points clés du PLU résumés",
    description:
      "L'IA extrait et synthétise les règles qui s'appliquent à votre parcelle : retraits, emprise maximale, hauteur limite, stationnement — sans lire 200 pages de règlement.",
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.4} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
      </svg>
    ),
    title: "Points bloquants identifiés",
    description:
      "Retrait insuffisant, emprise dépassée, hauteur hors norme — l'outil signale en temps réel ce qui pourrait compromettre l'obtention de votre permis de construire.",
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.4} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
      </svg>
    ),
    title: "Zone constructible visualisée",
    description:
      "Dessinez votre projet directement sur le plan cadastral et visualisez la zone autorisée selon les retraits PLU. Simulez extensions, surélévations ou constructions neuves.",
  },
];

function PluPromo() {
  return (
    <section className="bg-anthracite border-y border-anthracite-soft px-6 py-20 relative overflow-hidden">
      <span
        aria-hidden="true"
        className="absolute right-[-2vw] top-0 select-none text-[22vw] font-bold leading-none text-white/[0.022] pointer-events-none"
      >
        PLU
      </span>

      <div className="max-w-6xl mx-auto relative">

        {/* En-tête */}
        <div className="grid lg:grid-cols-[1fr_auto] gap-8 items-end mb-14">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <p className="text-terracotta text-[10px] font-medium tracking-[0.28em] uppercase">
                Outil en ligne
              </p>
              <span className="inline-flex items-center gap-1.5 bg-amber-500/15 border border-amber-400/25 text-amber-300 text-[9px] font-semibold tracking-[0.2em] uppercase px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                Bêta gratuit
              </span>
            </div>
            <h2 className="text-warm-white text-3xl md:text-4xl font-light leading-[1.15]">
              Analysez votre projet{" "}
              <span className="font-semibold">avant de vous lancer</span>
            </h2>
            <div className="w-14 h-px bg-terracotta mt-6" />
          </div>
          <a
            href="/plu"
            className="hidden lg:inline-flex items-center gap-3 bg-terracotta text-white text-[10px] font-semibold tracking-[0.2em] uppercase px-7 py-3.5 hover:bg-terracotta-dark transition-colors duration-200 shrink-0"
          >
            Tester l&apos;outil
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </a>
        </div>

        {/* Intro */}
        <p className="text-muted text-sm leading-relaxed max-w-2xl mb-12">
          Avant de consulter un professionnel ou de déposer un dossier,
          notre analyseur PLU vous donne une première lecture claire et immédiate
          de ce que la réglementation autorise sur votre terrain.
          Gratuit, sans inscription, en quelques minutes.
        </p>

        {/* Cards use cases */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-px bg-anthracite-soft">
          {pluUseCases.map(({ icon, title, description }) => (
            <div key={title} className="bg-[#1c1812] p-6 hover:bg-[#221e18] transition-colors duration-300">
              <div className="text-terracotta mb-4">{icon}</div>
              <h3 className="text-warm-white text-sm font-semibold leading-snug mb-3">{title}</h3>
              <p className="text-muted/65 text-xs leading-relaxed">{description}</p>
            </div>
          ))}
        </div>

        {/* CTA mobile */}
        <div className="mt-8 lg:hidden">
          <a
            href="/plu"
            className="inline-flex items-center gap-3 bg-terracotta text-white text-[10px] font-semibold tracking-[0.2em] uppercase px-7 py-3.5 hover:bg-terracotta-dark transition-colors duration-200"
          >
            Tester l&apos;outil
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </a>
        </div>

      </div>
    </section>
  );
}

function About() {
  return (
    <section id="a-propos" className="bg-anthracite-mid py-28 px-6">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">

        {/* Left: Portrait */}
        <div className="relative">
          <div className="aspect-[4/5] relative overflow-hidden">
            <Image
              src="/portrait.webp"
              alt="Portrait — Metaconception"
              fill
              className="object-cover"
              sizes="(max-width: 1024px) 100vw, 50vw"
              priority
            />

            {/* Corner accents */}
            <div className="absolute bottom-0 left-0 w-14 h-px bg-terracotta" />
            <div className="absolute bottom-0 left-0 w-px h-14 bg-terracotta" />
            <div className="absolute top-0 right-0 w-14 h-px bg-terracotta/35" />
            <div className="absolute top-0 right-0 w-px h-14 bg-terracotta/35" />
          </div>

          {/* Floating badge */}
          <div className="absolute -bottom-5 -right-5 bg-terracotta px-7 py-5 shadow-2xl shadow-terracotta/30">
            <div className="text-white">
              <span className="text-4xl font-light leading-none">15</span>
              <span className="text-xl font-extralight"> ans</span>
            </div>
            <p className="text-white/65 text-[9px] tracking-[0.22em] uppercase mt-1">
              d&apos;expérience
            </p>
          </div>
        </div>

        {/* Right: Content */}
        <div>
          <p className="text-terracotta text-[10px] font-medium tracking-[0.28em] uppercase mb-4">
            À propos
          </p>
          <h2 className="text-warm-white text-4xl md:text-5xl font-light leading-[1.15] mb-6">
            Une expertise<br />au service<br />de vos projets
          </h2>
          <div className="w-14 h-px bg-terracotta mb-9" />

          <div className="space-y-5 text-sm sm:text-base leading-relaxed text-warm-gray/60">
            <p>
              Basé à{" "}
              <strong className="text-warm-white font-medium">Junas, dans le Gard</strong>,
              je suis dessinateur-concepteur spécialisé en architecture, avec 15 ans
              d&apos;expérience forgée en{" "}
              <strong className="text-warm-white font-medium">Italie, à Paris et à Montpellier</strong>.
            </p>
            <p>
              Mon approche conjugue rigueur technique et sensibilité créative pour concevoir
              des espaces fonctionnels, esthétiques et conformes aux réglementations en vigueur.
            </p>
            <p>
              J&apos;interviens pour les{" "}
              <strong className="text-warm-white font-medium">
                particuliers, constructeurs, promoteurs et architectes
              </strong>
              , avec un accompagnement personnalisé de la faisabilité à l&apos;obtention des
              autorisations administratives.
            </p>
          </div>

          {/* Stats row */}
          <div className="mt-12 pt-8 border-t border-anthracite-soft grid grid-cols-3 gap-6">
            {[
              { value: "15+", label: "Ans\nd'expérience" },
              { value: "2", label: "Pays\nd'exercice" },
              { value: "100%", label: "Projets\nsuivis" },
            ].map(({ value, label }) => (
              <div key={label}>
                <p className="text-terracotta text-3xl font-light leading-none">{value}</p>
                <p className="text-muted/55 text-[10px] tracking-wide mt-2 whitespace-pre-line leading-snug">
                  {label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer id="footer" className="bg-anthracite border-t border-anthracite-soft py-20 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mb-14">

          {/* Brand */}
          <div>
            <p className="text-warm-white font-semibold tracking-[0.2em] uppercase text-[10px] mb-5">
              Metaconception
            </p>
            <p className="text-muted text-sm leading-relaxed">
              Dessinateur-concepteur en architecture.
              <br />
              Basé à Junas, Gard (30250).
            </p>
            <p className="text-muted/35 text-xs mt-5 leading-relaxed">
              Intervient dans le Gard, l&apos;Hérault
              <br />
              et toute la région Occitanie.
            </p>
          </div>

          {/* Contact */}
          <div>
            <p className="text-terracotta text-[9px] tracking-[0.28em] uppercase mb-5 font-medium">
              Contact
            </p>
            <ul className="space-y-3.5 text-sm">
              <li className="flex items-center gap-3">
                <span className="text-terracotta/60 text-[10px] font-mono w-7">adrs</span>
                <span className="text-muted/55">Junas, 30250 — Gard</span>
              </li>
            </ul>
          </div>

          {/* Services nav */}
          <div>
            <p className="text-terracotta text-[9px] tracking-[0.28em] uppercase mb-5 font-medium">
              Prestations
            </p>
            <ul className="space-y-2.5">
              {services.map((s) => (
                <li key={s.title}>
                  <a
                    href="#services"
                    className="text-muted/60 hover:text-warm-white transition-colors duration-200 text-xs tracking-wide"
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-8 border-t border-anthracite-soft flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <p className="text-muted/35 text-xs">
            © {new Date().getFullYear()} Metaconception. Tous droits réservés.
          </p>
          <div className="flex items-center gap-4">
            <a
              href="/mentions-legales"
              className="text-muted/35 text-xs hover:text-muted/70 transition-colors"
            >
              Mentions légales
            </a>
            <p className="text-muted/20 text-xs tracking-widest">metaconception.eu</p>
          </div>
        </div>
      </div>
    </footer>
  );
}

// ─── CONTACT ──────────────────────────────────────────────────────────────────

function Contact() {
  return (
    <section id="contact" className="bg-anthracite py-28 px-6">
      <div className="max-w-5xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-20">

          {/* Left */}
          <div>
            <p className="text-terracotta text-[10px] font-medium tracking-[0.28em] uppercase mb-4">
              Contact
            </p>
            <h2 className="text-warm-white text-4xl font-light leading-[1.15] mb-8">
              Parlons de<br />votre projet
            </h2>
            <div className="space-y-4 text-muted text-sm">
              <p>Junas, 30250<br />Gard, France</p>
              <p className="text-muted/60 text-xs leading-relaxed mt-6">
                Intervention dans le Gard,<br />
                l&apos;Hérault et le Vaucluse.
              </p>
            </div>
          </div>

          {/* Right: Form */}
          <ContactForm />

        </div>
      </div>
    </section>
  );
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────

export default function Home() {
  return (
    <main>
      <Hero />
      <Services />
      <PluPromo />
      <About />
      <Contact />
      <Footer />
    </main>
  );
}
