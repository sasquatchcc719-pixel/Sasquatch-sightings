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
    subject: `${params.businessName} service agreement and customer portal`,
    body: [
      firstName ? `Hi ${firstName},` : 'Hello,',
      `Thank you for choosing Sasquatch Carpet Cleaning. We created a secure customer portal for ${params.businessName} so your service agreement and confirmed appointments stay together in one place.`,
      `Your portal login email is ${params.contactEmail}. Use the secure button below, then select Continue to your account. On your first visit you will choose your own password. Use that email and password for future visits. If the one-time link has expired, use the password recovery option on that page or reply for a new link.`,
      `Agreement ready for review: ${params.agreementTitle}, version ${params.agreementVersion}.`,
      `A PDF copy of this exact published agreement is attached for your records. The secure portal is where you can send a note or sign it.`,
      `Before we set up recurring service, please review and electronically sign the service agreement. This is similar to approving the estimate: it records the services and terms you approve, including pricing and monthly invoicing. Any optional maintenance or frequency marked “to be agreed” is not yet a recurring commitment. We will confirm those details with you and send updated terms for approval before scheduling that work.`,
      `If you would rather move forward with only the approved one-time service, that is completely fine. You do not need to approve recurring work. Reply to this email or call or text us at (719) 249-8791 and we will schedule only that visit.`,
      `How to complete your setup:\n- Open the secure customer portal using the button below.\n- Choose your own password.\n- Confirm and save your business details, billing contact, and access instructions in the Agreement tab. You can leave anything that does not apply blank.\n- Review the agreement and services listed. Send us a note if anything needs to change.\n- Sign with your full name, title, and password when everything is correct.\n- Use the Appointments tab to see confirmed service dates after we schedule them.`,
      `Reviewing the agreement does not schedule anything automatically. We will confirm the actual service dates with you.`,
      `Thank you,\nCharles\nSasquatch Carpet Cleaning\n(719) 249-8791`,
    ].join('\n\n'),
  }
}
