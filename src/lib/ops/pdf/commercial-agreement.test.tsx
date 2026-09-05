import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { describe, expect, it } from 'vitest'
import { newAgreementContent, type CommercialAgreement } from '../commercial'
import { CommercialAgreementPDF } from './commercial-agreement'

describe('CommercialAgreementPDF', () => {
  it('renders the published agreement as a PDF attachment', async () => {
    const content = newAgreementContent('Saltgrass Colorado Springs')
    content.service_address = '1405 Jamboree Drive, Colorado Springs, CO'
    content.effective_from = '2026-09-05'
    content.provider_name = 'Charles Sewell'
    content.payment_terms = 'Invoices are issued monthly.'
    content.lines[0].method = 'Hot water extraction'
    const agreement: CommercialAgreement = {
      id: '11111111-1111-4111-8111-111111111111',
      customer_id: '22222222-2222-4222-8222-222222222222',
      source_estimate_id: null,
      previous_version_id: null,
      version: 1,
      revision: 1,
      status: 'published',
      content,
      content_hash: 'hash',
      published_at: '2026-09-05T12:00:00Z',
      signed_at: null,
      signed_name: null,
      signed_title: null,
      signed_email: null,
      signature_consent: null,
      created_at: '2026-09-05T12:00:00Z',
    }

    const pdf = Buffer.from(
      await renderToBuffer(<CommercialAgreementPDF agreement={agreement} />),
    )

    expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
    expect(pdf.length).toBeGreaterThan(1000)
  })
})
