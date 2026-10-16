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
  [
    'Start With Your Water Source',
    'Tell us about spots, scale, taste, odors or particles. We confirm whether your home uses utility water or a private well and choose the appropriate package.',
  ],
  [
    'Collect & Test',
    'We collect a water sample and send it to the lab for the selected panel. For utility water, we also review the report from your actual supplier.',
  ],
  [
    'Understand Your Options',
    'We explain the results and their limits. If treatment would help, final equipment selection requires a qualified plumber’s assessment and separate quote.',
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
              your home. We help you understand your water and whether
              softening, filtration or another option makes sense.
            </p>
            <a href="#water-pricing-title" className={styles.priceLink}>
              Municipal assessment $149 • Private well testing $349
              <span>
                During an existing cleaning appointment. Separate visit +$75.
              </span>
            </a>
            <a href="tel:+17192498791" className={styles.call}>
              Discuss My Water Assessment{' '}
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
          className={styles.leak}
          aria-labelledby="leak-protection-title"
        >
          <Image
            src="/tap/water-installations/automatic-shutoff.png"
            alt="Smart automatic main-water shutoff valve installed on copper plumbing with a leak sensor"
            width={1536}
            height={1024}
            sizes="(max-width: 700px) 90vw, 420px"
            className={styles.leakPhoto}
          />
          <div>
            <p className={styles.eyebrow}>Leak protection</p>
            <h2 id="leak-protection-title">
              Protect your home from plumbing leaks, too.
            </h2>
            <p>
              Leaks can happen in any home, regardless of water quality. Leak
              sensors, smart water monitors and automatic main-water shutoff
              systems can help detect leaks and limit water damage.
            </p>
            <p>
              A qualified plumber would need to check your home’s setup and
              quote compatible equipment and installation separately.
            </p>
          </div>
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
          <h2 id="water-pricing-title">Get answers about your water.</h2>
          <p>
            We collect your sample, handle shipping and laboratory testing, and
            walk you through the results. Each package covers one sampling
            location.
          </p>
          <article className={styles.package} aria-labelledby="municipal-title">
            <p className={styles.eyebrow}>City or utility water</p>
            <h3 id="municipal-title">Municipal Water Assessment</h3>
            <dl className={styles.prices}>
              <div>
                <dt>During an existing cleaning appointment</dt>
                <dd>
                  <span>$</span>149
                </dd>
              </div>
              <div>
                <dt>Separate collection visit</dt>
                <dd>
                  <span>$</span>224
                </dd>
              </div>
            </dl>
            <p>
              Get a clearer picture of your water’s hardness and mineral balance
              before choosing softening or filtration. Your assessment includes
              mineral testing, a review of your utility’s water report, and help
              understanding what the findings mean for your home.
            </p>
            <details>
              <summary>See what we test</summary>
              <p>
                Bicarbonate, calcium, carbonate, chloride, fluoride, iron,
                magnesium, nitrate, potassium, sodium, sulfate, total hardness,
                total alkalinity, electrical conductivity, pH, estimated total
                dissolved solids and cation/anion balance.
              </p>
            </details>
          </article>
          <article className={styles.package} aria-labelledby="well-title">
            <p className={styles.eyebrow}>Private well water</p>
            <h3 id="well-title">Private Well Testing</h3>
            <dl className={styles.prices}>
              <div>
                <dt>During an existing cleaning appointment</dt>
                <dd>
                  <span>$</span>349
                </dd>
              </div>
              <div>
                <dt>Separate collection visit</dt>
                <dd>
                  <span>$</span>424
                </dd>
              </div>
            </dl>
            <p>
              Take a broader look at your well water with testing for bacteria,
              minerals and selected metals, including lead and arsenic. We
              explain the findings and help you understand which treatment
              options may suit your home.
            </p>
            <details>
              <summary>See what we test</summary>
              <p>
                Total coliform and E. coli bacteria, alkalinity, hardness,
                chloride, fluoride, nitrate, nitrite, phosphate, sodium, total
                dissolved solids, pH, arsenic, cadmium, copper, iron, lead and
                manganese.
              </p>
            </details>
            <p>
              Typical laboratory turnaround is 8–10 business days; allow
              additional time for shipping.
            </p>
          </article>
          <p>
            A separate collection visit adds $75 to either package, as shown
            above. Equipment, plumbing installation and any additional testing
            are separate. Call to discuss your water source and arrange
            collection.
          </p>
          <a href="tel:+17192498791" className={styles.call}>
            <Phone size={20} aria-hidden="true" /> Call (719) 249-8791{' '}
            <ChevronRight size={22} aria-hidden="true" />
          </a>
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
