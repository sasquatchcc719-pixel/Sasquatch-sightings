export type ContractorCompany = {
  name: string
  phone?: string
  website?: string
  googleMapsUrl?: string
  whyRecommended: string
  notes?: string
  brand?: {
    initials: string
    logoSrc?: string
    accent: 'amber' | 'green'
  }
}

export type ContractorCategory = {
  id: string
  label: string
  shortLabel: string
  description: string
  companies: ContractorCompany[]
}

export const contractorCategories: ContractorCategory[] = [
  {
    id: 'plumbers',
    label: 'Plumbers',
    shortLabel: 'Plumbing',
    description:
      'Leaks, fixtures, shutoff valves, drain issues, and water lines.',
    companies: [],
  },
  {
    id: 'electricians',
    label: 'Electricians',
    shortLabel: 'Electrical',
    description:
      'Outlets, panels, lighting, safety issues, and small electrical jobs.',
    companies: [],
  },
  {
    id: 'carpet-repair',
    label: 'Carpet Repair',
    shortLabel: 'Carpet Repair',
    description:
      'Stretching, patching, transitions, seams, burns, and pet damage.',
    companies: [
      {
        name: 'Jim Gordon',
        phone: '401-742-3935',
        whyRecommended:
          'Jim is our go-to carpet repair guy for stretching, patching, seams, and repair work.',
        notes:
          'Phone only. Jim does not have a website, so calling is the best way to reach him.',
      },
    ],
  },
  {
    id: 'hvac',
    label: 'HVAC',
    shortLabel: 'HVAC',
    description: 'Heating, cooling, furnaces, AC, and air quality help.',
    companies: [],
  },
  {
    id: 'handyman',
    label: 'Handyman',
    shortLabel: 'Handyman',
    description: 'Small repairs, punch lists, drywall touch-ups, and odd jobs.',
    companies: [
      {
        name: 'Red Feather Handyman Services, LLC',
        phone: '827-715-5533',
        whyRecommended:
          "Evan is one of those guys who can fix just about anything — and everyone in the area seems to know him. Whether it's a door that won't close right, drywall that needs patching, or a dozen little things on your punch list, Evan shows up and gets it done.",
        notes: 'No website — call or email EvanCox308@gmail.com to reach him.',
      },
      {
        name: 'Hand & Hammer Home Services',
        phone: '719-722-7040',
        website: 'https://www.handhammerhomeservices.com/',
        brand: {
          initials: 'H&H',
          accent: 'amber',
        },
        whyRecommended:
          'Stephen Hand handles handyman and home improvement work around Monument, Palmer Lake, Woodmoor, and north Colorado Springs.',
        notes:
          'Good fit for small repairs, maintenance, carpentry, painting, minor plumbing, and minor electrical work.',
      },
    ],
  },
  {
    id: 'pressure-washing',
    label: 'Pressure Washing',
    shortLabel: 'Pressure Washing',
    description:
      'Exterior cleaning, driveways, patios, siding, decks, and concrete.',
    companies: [
      {
        name: "Levi's Custom Clean",
        phone: '719-354-3283',
        website: 'https://leviscustomclean.com/',
        whyRecommended:
          'Levi’s Custom Clean handles pressure washing, steam cleaning, graffiti removal, and gutter cleaning.',
        notes:
          'Good fit for patios, decks, driveways, siding, gutters, concrete, and exterior cleaning needs.',
      },
    ],
  },
  {
    id: 'home-projects-remodels',
    label: 'Home Projects and Remodels',
    shortLabel: 'Projects and Remodels',
    description:
      'Bigger home projects, outdoor work, remodels, carpentry, and punch-list help.',
    companies: [
      {
        name: 'Lumberjake Company',
        phone: '719-265-3001',
        website: 'https://www.lumberjakecompany.com/',
        brand: {
          initials: 'LJ',
          accent: 'amber',
        },
        whyRecommended:
          'Jacob is a trusted local project guy for custom woodworking, remodels, outdoor projects, and broader home improvement work.',
        notes:
          'Services include landscaping, fencing, sprinkler systems, excavation, handyman services, minor electrical, minor plumbing, custom cabinetry, decks, patios, concrete flatwork, tile, kitchen and bathroom remodels, and pergolas.',
      },
    ],
  },
  {
    id: 'roofing',
    label: 'Roofing',
    shortLabel: 'Roofing',
    description:
      'Roof inspections, repairs, replacements, and storm damage help.',
    companies: [
      {
        name: 'Revival Roofing',
        phone: '719-210-6445',
        website: 'https://revivalroofingco.com/',
        googleMapsUrl:
          'https://www.google.com/maps/search/?api=1&query=Revival%20Roofing%20Colorado%20Springs%2C%20CO',
        brand: {
          initials: 'RR',
          accent: 'amber',
        },
        whyRecommended:
          'Revival Roofing is the roofing company Sasquatch recommends for roof-related work.',
        notes:
          'Residential and commercial roofing contractor serving the Colorado Springs area.',
      },
    ],
  },
  {
    id: 'gunsmithing',
    label: 'Gunsmithing',
    shortLabel: 'Gunsmithing',
    description: 'Firearms service, repairs, and custom work.',
    companies: [
      {
        name: 'Red Feather Firearms',
        website: 'https://redfeatherfirearms.com/',
        whyRecommended:
          'Custom rifle builds, gunsmithing, and firearms finishing for all makes and models. Evan specializes in lightweight hunting rifles, long-range precision builds, custom AR platforms, and Cerakote finishing. FFL services available. Veterans, first responders, and teachers get 10% off.',
      },
    ],
  },
  {
    id: 'water-restoration',
    label: 'Water Damage and Restoration',
    shortLabel: 'Restoration',
    description:
      'Water losses, water mitigation, structural drying, and insurance jobs.',
    companies: [
      {
        name: 'Sasquatch Carpet Cleaning',
        phone: '719-249-8791',
        website: 'https://sasquatchcarpet.com',
        brand: {
          initials: 'SCC',
          logoSrc: '/sasquatch-tree-logo.svg',
          accent: 'green',
        },
        whyRecommended:
          'Sasquatch handles water mitigation and structural drying after a water loss.',
      },
    ],
  },
  {
    id: 'flooring',
    label: 'Flooring',
    shortLabel: 'Flooring',
    description:
      'Installers and repair pros for hard surface flooring projects.',
    companies: [
      {
        name: 'Affordable Flooring Connection',
        phone: '719-481-0831',
        website: 'https://affordableflooringconnection.com/',
        brand: {
          initials: 'AFC',
          accent: 'amber',
        },
        whyRecommended:
          'Affordable Flooring Connection is a local Monument flooring shop serving the Tri-Lakes and Colorado Front Range area.',
        notes:
          'Good fit for hardwood, laminate, luxury vinyl tile, carpet, and tile flooring projects.',
      },
    ],
  },
]

export function getContractorCategory(categoryId: string) {
  return contractorCategories.find((category) => category.id === categoryId)
}
