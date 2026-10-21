import type { CallRoutingConfig } from './call-routing-config'

export function escapeTwiml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[char]!,
  )
}

export function buildForwardDial(params: {
  config: CallRoutingConfig
  callerPhone: string
  callSid: string
  baseUrl: string
  mode: string
  secondary?: boolean
}) {
  const { config, callerPhone, callSid, baseUrl, mode, secondary } = params
  const timeout =
    mode === 'open-line'
      ? config.openLineTimeoutSeconds
      : mode === 'water-damage' || mode === 'technical'
        ? config.ivrTechnicalTimeoutSeconds
        : config.ivrScheduleTimeoutSeconds
  const target = secondary
    ? config.secondaryForwardNumber
    : config.primaryForwardNumber
  const next = `${baseUrl}/api/twilio/dial-failover?screened=1&mode=${encodeURIComponent(mode)}${secondary ? '&stage=secondary' : ''}`
  const screen = `${baseUrl}/api/twilio/call-accept?parent=${encodeURIComponent(callSid)}`
  return `<?xml version="1.0" encoding="UTF-8"?><Response>
  <Dial timeout="${timeout}" action="${escapeTwiml(next)}" callerId="${escapeTwiml(callerPhone)}" answerOnBridge="true">
    <Number url="${escapeTwiml(screen)}" method="POST">${escapeTwiml(target)}</Number>
  </Dial>
</Response>`
}
