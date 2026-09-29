import { commercialContactName } from './commercial'

export type CommercialSetupEmailDraft = {
  subject: string
  body: string
}

export function buildCommercialSetupEmailDraft(params: {
  businessName: string
  contactName: string
  contactEmail: string
  agreementTitle: string
  agreementVersion: number
}): CommercialSetupEmailDraft {
  const firstName = commercialContactName(
    params.contactName,
    params.businessName,
  ).split(/\s+/)[0]

  return {
    subject: `${params.businessName} payment setup, service scope, and customer portal`,
    body: [
      firstName ? `Hi ${firstName},` : 'Hello,',
      `Thank you for choosing Sasquatch Carpet Cleaning. We created a secure customer portal for ${params.businessName} so your vendor information, current service scope, W-9, and confirmed appointments stay together in one place.`,
      `Your portal login email is ${params.contactEmail}. Use the secure button below, then select Continue to your account. On your first visit you will choose your own password. Use that email and password for future visits. If the one-time link has expired, use the password recovery option on that page or reply for a new link.`,
      `Current service summary ready for review: ${params.agreementTitle}, version ${params.agreementVersion}. A PDF copy of that exact published summary is attached for your records.`,
      `This is not a contract requiring ${params.businessName} to use us for future or recurring cleaning. It does not reserve future dates, and no future work will be performed unless your team separately approves the scope, price, and appointment.`,
      `For vendor setup, we only need to confirm:\n- How Sasquatch should receive payment for work your team approves, including payment method and terms.\n- Where invoices should be submitted, plus any vendor-portal, purchase-order, or reference requirements.\n- The exact areas and cleaning services approved for the current work.\n- Building access, service-window, and on-site expectations.\n- Who we should contact if the scope or price needs approval.`,
      `No signature is required to give us this setup information. If ${params.businessName} does not sign vendor setup forms, simply reply to this email or send a note in the portal with the requested details and any corrections.`,
      `How to complete your setup:\n- Open the secure customer portal using the button below and choose your password.\n- Confirm and save the billing contact, payment process, invoice-submission instructions, purchase-order requirements, building access, and service expectations. Leave anything that does not apply blank.\n- Review the listed areas, services, pricing, and payment terms. Send us a note if anything needs to change.\n- Download our completed W-9 from Vendor paperwork whenever your accounts-payable team needs it.\n- Use the Appointments tab to see confirmed service dates after we schedule them.`,
      `Reviewing the service summary does not schedule anything automatically or create a commitment to future cleaning. We will confirm every actual service date with you.`,
      `Thank you,\nCharles\nSasquatch Carpet Cleaning\n(719) 249-8791`,
    ].join('\n\n'),
  }
}
