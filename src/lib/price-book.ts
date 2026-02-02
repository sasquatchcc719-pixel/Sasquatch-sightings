/**
 * Sasquatch Carpet Cleaning Price Book
 * Last updated: Feb 2, 2026
 * Note: These are ballpark prices - actual quotes may vary
 */

export const PRICE_BOOK = {
  // Carpet Cleaning
  carpetCleaning: {
    category: 'Carpet Cleaning',
    services: [
      {
        name: 'Maintenance Carpet Cleaning',
        price: 50,
        unit: 'per room',
        description: 'Pre Spray, Wand Hot Water Extraction',
      },
      {
        name: 'Hall/Bathroom Maintenance',
        price: 25,
        unit: 'per area',
        description: 'Small Area Carpet Cleaning',
      },
      {
        name: 'Small Hallway/Closet',
        price: 20,
        unit: 'per area',
        description: 'Hallway carpet cleaning',
      },
      {
        name: 'Deep Restoration Cleaning',
        price: 75,
        unit: 'per room',
        description: 'Pre Spray, Rotary Extraction, Sanitize, Grooming',
      },
      {
        name: 'Sasquatch Size Room (200-400 sqft)',
        price: 90,
        unit: 'per room',
        description: 'Standard clean for medium rooms',
      },
      {
        name: 'Monster Size Room (400-600 sqft)',
        price: 138,
        unit: 'per room',
        description: 'Large room cleaning',
      },
      {
        name: 'Jumbo Humungous Room (600-800 sqft)',
        price: 175,
        unit: 'per room',
        description: 'Extra-large room cleaning',
      },
      {
        name: 'Commercial Carpet Cleaning',
        price: 0.35,
        unit: 'per sqft',
        description: 'Commercial spaces',
      },
      {
        name: 'Carpet Cleaning (general)',
        price: 0.8,
        unit: 'per sqft',
        description: 'Per foot pricing',
      },
      {
        name: 'Step Carpet Cleaning',
        price: 4,
        unit: 'per step',
        description: 'Stairway steps',
      },
      {
        name: 'VLM/Encapsulation Cleaning',
        price: 0.28,
        unit: 'per sqft',
        description: 'Low Moisture Bonnet cleaning',
      },
      {
        name: 'Dryer Duct Cleaning',
        price: 65,
        unit: 'flat',
        description: 'Power brush dryer vent line',
      },
    ],
  },

  // Upholstery Cleaning
  upholsteryCleaning: {
    category: 'Upholstery Cleaning',
    services: [
      {
        name: 'Chair/Recliner',
        price: 75,
        unit: 'each',
        description: 'All cloth recliner',
      },
      {
        name: 'Love Seat',
        price: 69,
        unit: 'each',
        description: 'All cloth love seat',
      },
      {
        name: 'Sofa/Couch 3 Seat',
        price: 150,
        unit: 'each',
        description: '3 seat sofa',
      },
      {
        name: 'Sectional',
        price: 12,
        unit: 'per linear ft',
        description: 'Price per linear foot',
      },
      {
        name: 'Ottoman',
        price: 40,
        unit: 'each',
        description: 'Standard ottoman',
      },
      {
        name: 'Dining Chair Seat Only',
        price: 15,
        unit: 'each',
        description: 'Just the seat',
      },
      {
        name: 'Dining Chair Full',
        price: 29,
        unit: 'each',
        description: 'Front and back',
      },
      {
        name: 'Mattress Cleaning',
        price: 49,
        unit: 'per side',
        description: 'One side of mattress',
      },
      {
        name: 'Leather Chair',
        price: 99,
        unit: 'each',
        description: 'Clean and protect',
      },
      {
        name: 'Leather Love Seat',
        price: 159,
        unit: 'each',
        description: 'Clean and protect',
      },
      {
        name: 'Leather Sofa',
        price: 199,
        unit: 'each',
        description: 'Clean and protect',
      },
      {
        name: 'Leather Sectional',
        price: 25,
        unit: 'per foot',
        description: 'Clean, moisturize, protect',
      },
    ],
  },

  // Rug Cleaning
  rugCleaning: {
    category: 'Rug Cleaning',
    services: [
      {
        name: 'Rug 4x6',
        price: 25,
        unit: 'each',
        description: 'Wool or polyester',
      },
      {
        name: 'Rug 5x7',
        price: 30,
        unit: 'each',
        description: 'Wool or polyester',
      },
      {
        name: 'Rug 8x11',
        price: 70,
        unit: 'each',
        description: 'Wool or polyester',
      },
      {
        name: 'Runner 2.5x8',
        price: 20,
        unit: 'each',
        description: '8 foot runner',
      },
      {
        name: 'Rug Cleaning (general)',
        price: 0.8,
        unit: 'per sqft',
        description: 'Wool or polyester',
      },
      {
        name: 'Deep Clean Commercial Rug',
        price: 1.5,
        unit: 'per sqft',
        description: 'Pre-scrub with extraction',
      },
    ],
  },

  // Hard Surface
  hardSurface: {
    category: 'Hard Surface Cleaning',
    services: [
      {
        name: 'LVT/Vinyl Cleaning',
        price: 0.28,
        unit: 'per sqft',
        description: 'Auto scrub with approved product',
      },
      {
        name: 'Vinyl Flooring',
        price: 0.35,
        unit: 'per sqft',
        description: 'Rubber floor, vinyl etc',
      },
      {
        name: 'Tile & Grout Cleaning',
        price: 0.65,
        unit: 'per sqft',
        description: 'Pre-scrub and Hydroforce clean',
      },
      {
        name: 'Concrete Cleaning',
        price: 0.5,
        unit: 'per sqft',
        description: 'Vacuum, scrub, extract',
      },
      {
        name: 'Power Wash Concrete',
        price: 0.5,
        unit: 'per sqft',
        description: 'Heated high-pressure wash',
      },
      {
        name: 'Auto Scrubbing Floors',
        price: 0.28,
        unit: 'per sqft',
        description: 'LVT/Vinyl/Epoxy',
      },
      {
        name: 'Deep Auto Scrub',
        price: 0.5,
        unit: 'per sqft',
        description: 'Heavy degreasing for kitchens',
      },
      {
        name: 'Seal Coat Vinyl/LVT',
        price: 0.8,
        unit: 'per sqft',
        description: '3 coats of sealant',
      },
      {
        name: 'Scrub and Wax',
        price: 1.5,
        unit: 'per sqft',
        description: 'Auto scrub + 3 wax coats',
      },
      {
        name: 'Strip and Wax VCT',
        price: 2.0,
        unit: 'per sqft',
        description: 'Full strip and wax',
      },
      {
        name: 'Stairway Vinyl',
        price: 80,
        unit: 'per stairway',
        description: 'Sweep, scrub, wipe',
      },
    ],
  },

  // Deodorizers & Treatments
  treatments: {
    category: 'Deodorizers & Treatments',
    services: [
      {
        name: 'General Deodorizer',
        price: 12,
        unit: 'per room',
        description: 'Standard room treatment',
      },
      {
        name: 'Commercial Deodorizer',
        price: 0.04,
        unit: 'per sqft',
        description: 'Commercial carpet deodorant',
      },
      {
        name: 'Bio Release Urine Treatment',
        price: 25,
        unit: 'per room',
        description: 'UV inspection and injection',
      },
      {
        name: 'Pet Urine Injection Treatment',
        price: 25,
        unit: 'per area',
        description: 'UV inspection, Bio Release, Pre Spray',
      },
      {
        name: 'Scotchgard Protection',
        price: 25,
        unit: 'per room',
        description: 'Carpet protection',
      },
      {
        name: 'Heat Transfer Stain Removal',
        price: 35,
        unit: 'per stain',
        description: 'Red drink dye removal',
      },
      {
        name: 'Deep Clean Vomit',
        price: 65,
        unit: 'per area',
        description: 'Biohazard cleanup',
      },
    ],
  },

  // Water Restoration
  waterRestoration: {
    category: 'Water Restoration',
    services: [
      {
        name: 'Emergency Service (Business Hours)',
        price: 197.29,
        unit: 'service call',
        description: '9am-5pm Mon-Fri',
      },
      {
        name: 'Emergency Service (After Hours)',
        price: 295.92,
        unit: 'service call',
        description: 'Weekends, holidays, after 5pm',
      },
      {
        name: 'Water Extraction from Carpet',
        price: 0.58,
        unit: 'per sqft',
        description: 'Standard hours',
      },
      {
        name: 'Water Extraction (After Hours)',
        price: 0.86,
        unit: 'per sqft',
        description: 'Emergency rate',
      },
      {
        name: 'Water Extraction Hard Surface',
        price: 0.27,
        unit: 'per sqft',
        description: '',
      },
      {
        name: 'Labor',
        price: 125,
        unit: 'per hour',
        description: 'General labor',
      },
      {
        name: 'Daily Monitoring',
        price: 92.65,
        unit: 'per hour',
        description: 'Equipment and moisture readings',
      },
      {
        name: 'Equipment Setup',
        price: 92.65,
        unit: 'per hour',
        description: 'Hourly charge',
      },
      {
        name: 'Content Manipulation',
        price: 73.37,
        unit: 'per hour',
        description: 'Moving contents',
      },
      {
        name: 'Anti-Microbial Agent',
        price: 0.34,
        unit: 'per sqft',
        description: 'Prevent growth',
      },
      {
        name: 'HEPA Vacuuming',
        price: 1.36,
        unit: 'per sqft',
        description: 'Exposed framing floor',
      },
      {
        name: 'Tear Out Wet Carpet Pad',
        price: 0.72,
        unit: 'per sqft',
        description: 'Bag for disposal',
      },
      {
        name: 'Tear Out Wet Drywall (2ft cut)',
        price: 4.58,
        unit: 'per linear ft',
        description: '2 foot flood cut',
      },
      {
        name: 'Tear Out Wet Drywall (4ft cut)',
        price: 8.33,
        unit: 'per linear ft',
        description: '4 foot flood cut',
      },
      {
        name: 'Baseboard Detach',
        price: 1.57,
        unit: 'per linear ft',
        description: 'Save for future install',
      },
      {
        name: 'Tear Out Trim',
        price: 0.65,
        unit: 'per linear ft',
        description: 'Remove and dispose',
      },
      {
        name: 'Tear Out Wet Insulation',
        price: 0.91,
        unit: 'per sqft',
        description: 'Bag for disposal',
      },
      {
        name: 'Haul Debris',
        price: 195,
        unit: 'per truck load',
        description: '',
      },
    ],
  },

  // Equipment Rental
  equipmentRental: {
    category: 'Equipment Rental (24hr)',
    services: [
      {
        name: 'Air Scrubber',
        price: 97,
        unit: 'per day',
        description: '3 days total rental',
      },
      {
        name: 'Axial Fan Air Mover',
        price: 35,
        unit: 'per day',
        description: '24 hour rental',
      },
      {
        name: 'Floor Fan',
        price: 24.5,
        unit: 'per day',
        description: '24 hour rental',
      },
      {
        name: 'Small Dehumidifier (70-109 PPD)',
        price: 72.5,
        unit: 'per day',
        description: '24 hour rental',
      },
      {
        name: 'Large LGR Dehumidifier (110-159 PPD)',
        price: 105.46,
        unit: 'per day',
        description: '24 hour rental',
      },
    ],
  },

  // Misc
  misc: {
    category: 'Miscellaneous',
    services: [
      {
        name: 'AC Coil Cleaning',
        price: 40,
        unit: 'each',
        description: 'Disassemble, clean, reassemble',
      },
      {
        name: 'Mileage/Travel',
        price: 1,
        unit: 'per mile',
        description: 'Travel charge',
      },
      {
        name: 'Card Fee',
        price: 0.04,
        unit: 'percentage',
        description: 'Credit card processing',
      },
      {
        name: 'Dump Fee',
        price: 80,
        unit: 'per load',
        description: 'Disposal fee',
      },
    ],
  },
}

// Format price book for Harry's context
export function getPriceBookSummary(): string {
  const sections: string[] = []

  for (const [, category] of Object.entries(PRICE_BOOK)) {
    const lines = [`**${category.category}:**`]
    for (const service of category.services) {
      const priceStr =
        service.price < 1 ? `$${service.price.toFixed(2)}` : `$${service.price}`
      lines.push(`- ${service.name}: ${priceStr} ${service.unit}`)
    }
    sections.push(lines.join('\n'))
  }

  return sections.join('\n\n')
}

// Quick lookup for common questions
export function findService(
  query: string,
): typeof PRICE_BOOK.carpetCleaning.services {
  const results: typeof PRICE_BOOK.carpetCleaning.services = []
  const queryLower = query.toLowerCase()

  for (const category of Object.values(PRICE_BOOK)) {
    for (const service of category.services) {
      if (
        service.name.toLowerCase().includes(queryLower) ||
        service.description.toLowerCase().includes(queryLower)
      ) {
        results.push(service)
      }
    }
  }

  return results
}
