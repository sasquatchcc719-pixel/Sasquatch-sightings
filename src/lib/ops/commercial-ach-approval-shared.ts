const ADMIN_BASE_URL = 'https://sightings.sasquatchcarpet.com'

export type CommercialAchAccessStatus =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'revealed'
  | 'expired'
  | 'delivery_failed'

export function isCommercialAchTelegramApprover(userId: number): boolean {
  if (!process.env.TELEGRAM_RELAY_SECRET_TOKEN) return false
  const allowed = [
    process.env.CHARLES_TELEGRAM_USER_ID,
    process.env.CHARLES_TELEGRAM_CHAT_ID,
  ].filter((value): value is string => Boolean(value))
  return allowed.length > 0 && allowed.includes(String(userId))
}

export function commercialAchTelegramCard(params: {
  requestId: string
  businessName: string
  requesterName: string
  requesterEmail: string
  requestedAt: Date
  customerId: string
}) {
  return {
    message: [
      'ACH ACCESS REQUEST',
      '',
      params.businessName,
      `Requested by: ${params.requesterName}`,
      `Email: ${params.requesterEmail}`,
      `Time: ${params.requestedAt.toLocaleString('en-US', { timeZone: 'America/Denver' })}`,
      '',
      'Approval allows this exact portal user to reveal the ACH instructions once within 15 minutes.',
      `Account: ${ADMIN_BASE_URL}/admin/operations/commercial/${params.customerId}`,
    ].join('\n'),
    buttons: [
      [
        {
          text: 'Approve for 15 minutes',
          callback_data: `ach:approve:${params.requestId}`,
        },
        {
          text: 'Deny',
          callback_data: `ach:deny:${params.requestId}`,
        },
      ],
    ],
  }
}
