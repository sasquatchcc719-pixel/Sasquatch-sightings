// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { generateInvoicePDF } from './generate'
import { invoicePhotoService, getServicePhoto } from '@/lib/ops/service-photos'

const directService = {
  name: 'Low Moisture Encapsulation Cleaning',
  category: 'Carpet Cleaning',
}
const appointmentService = {
  name: 'Wall Tile Cleaning',
  category: 'Tile Cleaning',
}

describe('invoice service photos', () => {
  it('retains the canonical service after a line description is renamed', () => {
    const service = invoicePhotoService({
      description: 'Living room',
      service_catalog_items: directService,
      ops_appointment_line_items: [
        { service_catalog_items: appointmentService },
      ],
    })
    expect(service).toEqual(directService)
    expect(getServicePhoto(service)?.src).toContain('low-moisture')

    const legacyService = invoicePhotoService({
      description: 'Restroom walls',
      ops_appointment_line_items: {
        service_catalog_items: [appointmentService],
      },
    })
    expect(getServicePhoto(legacyService)?.src).toContain('wall-tile')
    expect(
      getServicePhoto({ name: 'Leather Sofa', category: 'Upholstery' }),
    ).toBeUndefined()
  })

  it('embeds JPEG and WebP service photos in an actual invoice PDF', async () => {
    const pdf = await generateInvoicePDF({
      invoiceId: 'photo-test',
      isPaid: false,
      customerName: 'Local test',
      serviceAddress: 'Local test address',
      serviceDate: '2026-10-18',
      lineItems: [
        'Low Moisture Encapsulation Cleaning',
        'Commercial carpet cleaning',
        'Sofa / Couch',
        'Step Carpet Cleaning',
        'Area Rug 8x11',
        'Legendary Restoration',
        'Auto scrubbing Floors',
        'Tile & grout cleaning',
        'Wall Tile Cleaning',
        'Small Area / Walk-in Closet (up to 100 sq ft)',
        'Regular Size Room (100 to 200 Sqft)',
        'Sasquatch Size Room (200 to 400 Sqft)',
        'Monster Size Room (400 to 600 Sqft)',
        'Jumbo Humongous Room (600 to 800 Sqft)',
      ].map((name) => ({
        description: 'Renamed service area',
        service_catalog_items: { name },
        quantity: 1,
        unit_price: 10,
        line_total: 10,
      })),
      discountAmount: 0,
      subtotal: 140,
      total: 140,
    })
    expect(pdf?.subarray(0, 4).toString()).toBe('%PDF')
    expect(pdf?.toString('latin1').match(/\/Subtype \/Image/g)).toHaveLength(14)
  })
})
