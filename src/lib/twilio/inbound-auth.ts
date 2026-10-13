import twilio from 'twilio'

function requestPublicUrl(request: Request) {
  const configured =
    process.env.TWILIO_WEBHOOK_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL
  if (!configured) return request.url
  const incoming = new URL(request.url)
  const publicUrl = new URL(configured)
  publicUrl.pathname = incoming.pathname
  publicUrl.search = incoming.search
  publicUrl.hash = ''
  return publicUrl.toString()
}

export function validateTwilioInboundRequest(params: {
  request: Request
  form: Record<string, string>
  authToken?: string
  accountSid?: string
  publicUrl?: string
}) {
  const authToken = params.authToken ?? process.env.TWILIO_AUTH_TOKEN
  const accountSid = params.accountSid ?? process.env.TWILIO_ACCOUNT_SID
  if (!authToken || !accountSid) return false
  if (params.form.AccountSid !== accountSid) return false
  return twilio.validateRequest(
    authToken,
    params.request.headers.get('x-twilio-signature') || '',
    params.publicUrl || requestPublicUrl(params.request),
    params.form,
  )
}

export const twilioInboundPublicUrl = requestPublicUrl
