import { z } from 'zod'

const text = z.string().trim().max(5000)
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    'Invalid date',
  )
export const commercialProfileSchema = z.object({
  legal_name: text,
  billing_contact: text,
  billing_email: z.union([z.email(), z.literal('')]),
  purchase_order: text,
  access_instructions: text,
  service_windows: text,
  site_notes: text,
})
export type CommercialProfile = z.infer<typeof commercialProfileSchema>
export const emptyProfile: CommercialProfile = {
  legal_name: '',
  billing_contact: '',
  billing_email: '',
  purchase_order: '',
  access_instructions: '',
  service_windows: '',
  site_notes: '',
}
export const scopeLineSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(300),
  area: text,
  phase: z.enum(['initial', 'recurring', 'optional']),
  quantity: z.number().finite().positive().max(10000000),
  unit: z.string().trim().min(1).max(80),
  unit_price: z.number().finite().min(0).max(1000000),
  method: text,
  frequency: text,
  service_window: text,
  notes: text,
  service_catalog_item_id: z.uuid().nullable(),
  length_value: z.number().finite().nullable(),
  width_value: z.number().finite().nullable(),
  area_segments: z
    .array(
      z.object({
        length: z.number().finite().positive(),
        width: z.number().finite().positive(),
      }),
    )
    .max(100)
    .nullable(),
})
export const agreementContentSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    business_name: z.string().trim().min(1).max(300),
    service_address_id: z.uuid().nullable(),
    service_address: text,
    effective_from: z.union([date, z.literal('')]),
    effective_until: z.union([date, z.literal('')]),
    provider_name: text,
    payment_terms: text,
    cancellation_terms: text,
    access_terms: text,
    quality_standards: text,
    exclusions: text,
    additional_terms: text,
    lines: z.array(scopeLineSchema).min(1).max(100),
  })
  .refine(
    (v) =>
      !v.effective_until ||
      (!!v.effective_from && v.effective_until >= v.effective_from),
    'End date must follow start date',
  )
export type AgreementContent = z.infer<typeof agreementContentSchema>
export type ScopeLine = z.infer<typeof scopeLineSchema>
export type CommercialAgreement = {
  id: string
  customer_id: string
  source_estimate_id: string | null
  previous_version_id: string | null
  version: number
  revision: number
  status: 'draft' | 'published' | 'signed' | 'withdrawn'
  content: AgreementContent
  content_hash: string | null
  published_at: string | null
  signed_at: string | null
  signed_name: string | null
  signed_title: string | null
  signed_email: string | null
  signature_consent: string | null
  created_at: string
}
export type CommercialData = {
  profile: CommercialProfile
  agreements: CommercialAgreement[]
  businessName: string
  addresses: {
    id: string
    label: string | null
    street_1: string
    city: string
    state: string
    zip_code: string
  }[]
}
export const SIGNATURE_CONSENT =
  'I am authorized to sign for this business. I have reviewed this agreement, agree to its terms, consent to electronic records and signatures, and intend my typed name to be my signature. I can download and retain a copy. I may request a paper signing process before signing by contacting Sasquatch Carpet Cleaning.'
export function lineAmount(line: Pick<ScopeLine, 'quantity' | 'unit_price'>) {
  return Math.round(line.quantity * line.unit_price * 100) / 100
}
export function commercialUnit(unit: string): string {
  return (
    (
      {
        per_sq_ft: 'sq ft',
        per_hour: 'hours',
        per_linear_ft: 'linear ft',
        per_item: 'items',
        flat: 'service',
        per_room: 'rooms',
      } as Record<string, string>
    )[unit] || unit.replaceAll('_', ' ')
  )
}
export function phaseTotal(
  content: AgreementContent,
  phase: ScopeLine['phase'],
) {
  return (
    Math.round(
      content.lines
        .filter((l) => l.phase === phase)
        .reduce((sum, l) => sum + lineAmount(l), 0) * 100,
    ) / 100
  )
}
export function publicationIssues(content: AgreementContent): string[] {
  return [
    !content.service_address.trim() && 'Enter the service address.',
    !content.effective_from && 'Choose the agreement start date.',
    !content.provider_name.trim() &&
      'Enter the Sasquatch representative approving these terms.',
    !content.payment_terms.trim() && 'Confirm payment terms.',
    !content.cancellation_terms.trim() &&
      'Confirm cancellation and rescheduling terms.',
    !content.quality_standards.trim() &&
      'Describe the service quality and inspection process.',
    content.lines.some((l) => !l.method.trim() || !l.frequency.trim()) &&
      'Every service needs a method and frequency (including one-time or on request).',
  ].filter((v): v is string => !!v)
}
export function blankScopeLine(): ScopeLine {
  return {
    id: crypto.randomUUID(),
    name: 'Carpet cleaning',
    area: '',
    phase: 'initial',
    quantity: 1,
    unit: 'each',
    unit_price: 0,
    method: '',
    frequency: 'One-time service',
    service_window: '',
    notes: '',
    service_catalog_item_id: null,
    length_value: null,
    width_value: null,
    area_segments: null,
  }
}
export function newAgreementContent(businessName: string): AgreementContent {
  return {
    title: 'Commercial Cleaning Service Agreement',
    business_name: businessName,
    service_address_id: null,
    service_address: '',
    effective_from: '',
    effective_until: '',
    provider_name: '',
    payment_terms: '',
    cancellation_terms: '',
    access_terms:
      'The client will provide agreed access, notify the on-site team, and identify restricted areas and known floor conditions before service. Furniture handling is included only where listed in the service scope. The crew will communicate drying and safe re-entry instructions before leaving.',
    quality_standards:
      'Before cleaning, confirm the listed work areas and document visible conditions. Select the cleaning method appropriate to the material and soil condition. After service, inspect the treated areas with the available site contact, document any remaining concerns, and provide care and drying instructions. Report a service concern to Sasquatch for assessment and an agreed corrective plan.',
    exclusions:
      'Only the areas and services listed in this agreement are included. Permanent stains, wear, discoloration, underlying damage, and unlisted repairs are not promised to be corrected by cleaning. Additional work or changed quantities require an agreed scope and price before proceeding.',
    additional_terms:
      'Requested dates and service changes require confirmation by Sasquatch. Signing this agreement does not reserve an appointment. Changes to signed terms require a new agreement version accepted by both parties. Scheduled work and billing are managed separately from this agreement.',
    lines: [blankScopeLine()],
  }
}
export const serviceRequestDetailsSchema = z
  .object({
    preferred_date: z.union([date, z.literal('')]).optional(),
    preferred_time: z.string().max(100).optional(),
    service: z.string().max(500).optional(),
    area: z.string().max(1000).optional(),
    frequency: z.string().max(300).optional(),
  })
  .strict()
