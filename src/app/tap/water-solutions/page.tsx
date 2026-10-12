'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  ChevronRight,
  Cylinder,
  Droplet,
  Droplets,
  FlaskConical,
  GlassWater,
  Leaf,
  Phone,
  Settings,
  ShieldCheck,
  Sun,
} from 'lucide-react'
import styles from './water-solutions.module.css'

const treatments = [
  {
    name: 'Sediment Filtration',
    description: 'For sand, grit and suspended particles.',
    icon: Cylinder,
  },
  {
    name: 'Chlorine & Chloramine Filtration',
    description:
      'Media selected for taste, odor and your water supply’s disinfectant.',
    icon: Droplet,
  },
  {
    name: 'Water Softening & Scale Control',
    description:
      'Different approaches to hardness and scale—with different results.',
    icon: Droplets,
  },
  {
    name: 'Drinking-Water Filtration & RO',
    description:
      'Targeted under-sink treatment for drinking and cooking water.',
    icon: GlassWater,
  },
  {
    name: 'Iron, Manganese & Sulfur Treatment',
    description: 'Specialty options for measured causes of stains and odors.',
    icon: Settings,
  },
  {
    name: 'pH & Corrosion Treatment',
    description: 'Water chemistry and plumbing assessment guide the approach.',
    icon: FlaskConical,
  },
  {
    name: 'UV Disinfection',
    description:
      'Microbial treatment with appropriate pretreatment and maintenance.',
    icon: Sun,
  },
  {
    name: 'Targeted Contaminant Reduction',
    description:
      'Specific systems for lab findings such as lead, nitrate, arsenic or PFAS.',
    icon: ShieldCheck,
  },
]

const steps = [
  ['Collect & Test', 'Choose a panel for your water source and concerns.'],
  [
    'Understand Your Results',
    'See the findings and treatment categories worth evaluating.',
  ],
  [
    'Professional Assessment',
    'A qualified plumbing professional makes the final system recommendation and quote.',
  ],
]

export default function WaterSolutionsPage() {
  const cardId = useSearchParams().get('card')
  const cardHref = cardId ? `/tap?card=${encodeURIComponent(cardId)}` : '/tap'

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <header className={styles.brand}>
          <Image
            src="/sasquatch-website-logo.png"
            alt="Sasquatch Carpet Cleaning"
            width={2723}
            height={1155}
            sizes="(max-width: 600px) 82vw, 380px"
            className={styles.logo}
            priority
          />
          <Link href={cardHref} className={styles.back}>
            <ArrowLeft size={17} aria-hidden="true" /> Back to your card
          </Link>
        </header>

        <section className={styles.hero} aria-labelledby="water-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>
              Water Testing • Treatment • Leak Protection
            </p>
            <h1 id="water-title">
              Your neighbor’s water filter may not be right for your home.
            </h1>
            <p className={styles.intro}>
              Water can vary by supply, neighborhood, and the plumbing inside
              your home. The right solution starts with understanding your
              water.
            </p>
            <a href="tel:+17192498791" className={styles.call}>
              Arrange My Water Test{' '}
              <ChevronRight size={22} aria-hidden="true" />
            </a>
          </div>
          <Image
            src="/tap/water-installations/water-softener.png"
            alt="Professionally installed water softener and brine tank connected to the home’s plumbing"
            width={1536}
            height={1024}
            sizes="(max-width: 700px) 100vw, 500px"
            className={styles.heroPhoto}
            priority
          />
        </section>

        <section
          className={styles.difference}
          aria-labelledby="different-water-title"
        >
          <span className={styles.leaf}>
            <Leaf size={40} strokeWidth={1.4} aria-hidden="true" />
          </span>
          <div>
            <h2 id="different-water-title">
              Different water. Different problems. Different solutions.
            </h2>
            <p>
              One filter does not do every job. Testing helps narrow the choices
              before you buy equipment.
            </p>
          </div>
        </section>

        <section
          className={styles.options}
          aria-labelledby="water-options-title"
        >
          <h2 id="water-options-title">What might your water need?</h2>
          <ul className={styles.treatments}>
            {treatments.map(({ name, description, icon: Icon }) => (
              <li key={name}>
                <span className={styles.treatmentIcon}>
                  <Icon size={29} strokeWidth={1.5} aria-hidden="true" />
                </span>
                <div>
                  <h3>{name}</h3>
                  <p>{description}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className={styles.guidance}>
            Your home may need one targeted system, a combination—or no
            additional treatment.
          </p>
        </section>

        <section
          className={styles.process}
          aria-labelledby="water-process-title"
        >
          <h2 id="water-process-title">A simple process.</h2>
          <ol className={styles.steps}>
            {steps.map(([title, description], index) => (
              <li key={title}>
                <span className={styles.stepNumber} aria-hidden="true">
                  {index + 1}
                </span>
                <div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section
          className={styles.pricing}
          aria-labelledby="water-pricing-title"
        >
          <h2 id="water-pricing-title">Start with a water test.</h2>
          <dl className={styles.prices}>
            <div>
              <dt>During an existing Sasquatch appointment</dt>
              <dd>
                <span>$</span>250
              </dd>
            </div>
            <div>
              <dt>Separate collection visit</dt>
              <dd>
                <span>$</span>300
              </dd>
            </div>
          </dl>
          <p>
            Includes one sampling location, the selected baseline laboratory
            panel, sample handling and delivery of results.
          </p>
          <p>
            Your water test provides a baseline to help guide treatment choices.
            Filtration equipment and plumbing installation are quoted
            separately.
          </p>
          <a href="tel:+17192498791" className={styles.call}>
            <Phone size={20} aria-hidden="true" /> Call (719) 249-8791{' '}
            <ChevronRight size={22} aria-hidden="true" />
          </a>
        </section>

        <section
          className={styles.leak}
          aria-labelledby="leak-protection-title"
        >
          <Image
            src="/tap/water-installations/automatic-shutoff.png"
            alt="Smart automatic main-water shutoff valve installed on copper plumbing with a leak sensor"
            width={1536}
            height={1024}
            sizes="(max-width: 700px) 100vw, 450px"
            className={styles.leakPhoto}
          />
          <div>
            <h2 id="leak-protection-title">
              Protect your home from plumbing leaks, too.
            </h2>
            <p>
              Leak sensors, smart water monitors and automatic shutoff systems
              require a separate plumbing assessment.
            </p>
          </div>
        </section>

        <footer className={styles.footer}>
          <Image
            src="/hero-layer-forest.png"
            alt=""
            fill
            sizes="(max-width: 1100px) 100vw, 1100px"
            className={styles.forest}
          />
          <div>
            <p className={styles.footerName}>Sasquatch Carpet Cleaning</p>
            <a href="https://www.sasquatchcarpet.com">
              www.sasquatchcarpet.com
            </a>
            <a href="tel:+17192498791">(719) 249-8791</a>
          </div>
        </footer>
      </div>
    </main>
  )
}
