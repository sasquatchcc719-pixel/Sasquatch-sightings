'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, Phone } from 'lucide-react'
import styles from './water-solutions.module.css'

const steps = [
  [
    'Independent lab testing',
    'A water sample is sent to an independent lab. Your water source and concerns guide the test panel.',
  ],
  [
    'Review your results',
    'Understand the findings and relevant treatment options.',
  ],
  ['Choose your solution', 'Compare appropriate options and decide what fits.'],
  [
    'Professional installation',
    'A qualified plumber installs the selected system.',
  ],
]

const products = [
  {
    name: 'Water Softeners',
    purpose: 'For hardness and scale',
    description:
      'Reduces calcium and magnesium hardness to help limit scale and soap residue. Typically uses salt and needs routine upkeep. A softener is not a general drinking-water filter.',
    photo: 'Water softener and salt tank',
    y: 706,
    height: 161,
  },
  {
    name: 'Whole-House Filtration',
    purpose: 'For water throughout your home',
    description:
      'Treats incoming water with selected filter media. Options can address sediment, chlorine, taste or odor. Filter type and service schedule depend on the water and system.',
    photo: 'Whole-house water filter housings connected to copper plumbing',
    y: 877,
    height: 155,
  },
  {
    name: 'Reverse Osmosis',
    purpose: 'For drinking and cooking water',
    description:
      'Usually installed under a kitchen sink. Uses a membrane and filters to reduce selected dissolved substances. Choose verified reduction claims; filters and membranes require replacement.',
    photo: 'Under-sink reverse osmosis filters and storage tank',
    y: 1042,
    height: 153,
  },
  {
    name: 'Specialty Filtration',
    purpose: 'For specific test findings',
    description:
      'Targets measured issues such as iron or manganese. The right media and system depend on concentrations and water chemistry. Testing guides whether specialty treatment is appropriate.',
    photo: 'Specialty water filtration tank in a utility room',
    y: 1208,
    height: 165,
  },
  {
    name: 'Automatic Emergency Water Shutoff',
    purpose: 'Help stop water damage at the source',
    description:
      'When a leak is detected, a compatible automatic shutoff system can close your home’s main water supply—helping keep a small leak from becoming major water damage.',
    photo: 'Automatic shutoff valve on the water supply with a leak sensor',
    y: 1386,
    height: 172,
  },
]

export default function WaterSolutionsPage() {
  const cardId = useSearchParams().get('card')
  const cardHref = cardId ? `/tap?card=${encodeURIComponent(cardId)}` : '/tap'

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <Link href={cardHref} className={styles.back}>
          <ArrowLeft size={18} aria-hidden="true" /> Back to your card
        </Link>
        <header className={styles.hero}>
          <Image
            src="/sasquatch-website-logo.png"
            alt="Sasquatch Carpet Cleaning"
            width={2723}
            height={1155}
            sizes="(max-width: 560px) 76vw, 400px"
            className={styles.logo}
            priority
          />
          <h1>
            We Know Clean.
            <br />
            And Clean Starts With Water.
          </h1>
          <p className={styles.subtitle}>
            Water Testing, Treatment &amp; Leak Protection
          </p>
          <p className={styles.intro}>
            Water quality affects cleaning throughout your home. Start with
            independent testing, then explore options that fit your water and
            your needs.
          </p>
        </header>

        <section
          className={styles.process}
          aria-labelledby="water-process-title"
        >
          <h2 id="water-process-title">
            A clear path from testing to installation
          </h2>
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
          className={styles.options}
          aria-labelledby="water-options-title"
        >
          <h2 id="water-options-title">Explore your home’s options</h2>
          <div className={styles.products}>
            {products.map((product) => (
              <article key={product.name} className={styles.product}>
                <div
                  role="img"
                  aria-label={product.photo}
                  className={styles.productPhoto}
                  style={{
                    aspectRatio: `300 / ${product.height}`,
                    backgroundSize: `${(887 / 300) * 100}% auto`,
                    backgroundPosition: `${(2 / (887 - 300)) * 100}% ${(product.y / (1774 - product.height)) * 100}%`,
                  }}
                />
                <div className={styles.productCopy}>
                  <h3>{product.name}</h3>
                  <p className={styles.purpose}>{product.purpose}</p>
                  <p>{product.description}</p>
                </div>
              </article>
            ))}
          </div>
          <p className={styles.guidance}>
            Not every home needs every product. Treatment follows test results;
            leak protection follows a plumbing assessment.
          </p>
        </section>

        <footer className={styles.footer}>
          <h2>Call to arrange your water test</h2>
          <a href="tel:+17192498791" className={styles.call}>
            <Phone size={25} aria-hidden="true" /> (719) 249-8791
          </a>
          <a href="https://www.sasquatchcarpet.com" className={styles.website}>
            www.sasquatchcarpet.com
          </a>
        </footer>
      </div>
    </main>
  )
}
