/**
 * AI Description Generator API Route
 * Uses templates since Gemini is broken
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/supabase/server'

// Professional templates by service type
const templates: Record<string, string[]> = {
  default: [
    "Professional carpet cleaning service completed in {city}, Colorado. Our certified technicians used state-of-the-art equipment to restore your carpets to like-new condition.",
    "Quality carpet care delivered in {city}, Colorado. Our experienced team provided thorough cleaning using industry-leading techniques and eco-friendly solutions.",
    "Expert carpet cleaning performed in {city}, Colorado. We pride ourselves on exceptional results and customer satisfaction.",
  ],
  'Standard Carpet Cleaning': [
    "Complete carpet cleaning service in {city}, Colorado. Our team deep-cleaned all carpeted areas, removing embedded dirt and allergens for a fresher, healthier home.",
    "Professional standard carpet cleaning completed in {city}, Colorado. We used hot water extraction to remove deep-seated dirt and leave your carpets looking revitalized.",
  ],
  'Deep Carpet Restoration': [
    "Deep carpet restoration service performed in {city}, Colorado. Our intensive cleaning process revived heavily soiled carpets, bringing them back to their original beauty.",
    "Comprehensive deep cleaning completed in {city}, Colorado. We tackled tough stains and ground-in dirt to restore your carpet's appearance and extend its life.",
  ],
  'Pet Urine Removal': [
    "Specialized pet urine treatment completed in {city}, Colorado. Our enzyme-based solutions neutralized odors and removed stains at the source for a fresh, clean home.",
    "Professional pet stain and odor removal in {city}, Colorado. We eliminated pet accidents completely, leaving your carpets clean and odor-free.",
  ],
  'Stain Removal': [
    "Expert stain removal service in {city}, Colorado. Our technicians successfully treated and removed stubborn stains using professional-grade solutions.",
    "Targeted stain treatment completed in {city}, Colorado. We addressed problem spots with specialized techniques for outstanding results.",
  ],
  'Commercial Carpet Cleaning': [
    "Commercial carpet cleaning service completed in {city}, Colorado. We provided thorough cleaning for your business, minimizing disruption while maximizing results.",
    "Professional commercial carpet care in {city}, Colorado. Our team delivered efficient, high-quality cleaning to keep your workplace looking professional.",
  ],
  'Upholstery Cleaning': [
    "Upholstery cleaning service completed in {city}, Colorado. We refreshed your furniture using gentle yet effective cleaning methods safe for all fabric types.",
    "Professional upholstery care in {city}, Colorado. Our team restored your furniture's appearance while extending its lifespan.",
  ],
  'Area Rug Cleaning': [
    "Specialty area rug cleaning in {city}, Colorado. We carefully cleaned your rugs using techniques appropriate for their specific materials and construction.",
    "Professional rug cleaning completed in {city}, Colorado. Your area rugs received expert care for beautiful, lasting results.",
  ],
  'Tile & Grout Cleaning': [
    "Tile and grout cleaning service in {city}, Colorado. We restored your floors to their original luster, removing built-up grime and discoloration.",
    "Professional tile cleaning completed in {city}, Colorado. Our deep cleaning process revitalized your tile and grout for a like-new appearance.",
  ],
}

export async function POST(request: NextRequest) {
  try {
    // Check authentication (admin only)
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse request body
    const { serviceType, city, notes } = await request.json()

    // Validate required fields
    if (!serviceType || !city) {
      return NextResponse.json(
        { error: 'Service type and city are required' },
        { status: 400 }
      )
    }

    // Get templates for this service type (or default)
    const serviceTemplates = templates[serviceType] || templates.default
    
    // Pick a random template
    const template = serviceTemplates[Math.floor(Math.random() * serviceTemplates.length)]
    
    // Replace placeholders
    let description = template.replace(/{city}/g, city)
    
    // Add notes if provided
    if (notes && notes.trim()) {
      description += ` ${notes.trim()}`
    }

    console.log('✅ Generated description from template')

    return NextResponse.json({
      success: true,
      description,
    })
  } catch (error) {
    console.error('❌ Error:', error)
    return NextResponse.json(
      { error: 'Failed to generate description.' },
      { status: 500 }
    )
  }
}
