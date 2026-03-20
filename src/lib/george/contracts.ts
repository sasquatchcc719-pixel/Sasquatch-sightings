export type GeorgeActionName =
  | 'set_open_line_mode'
  | 'set_harry_toggle'
  | 'hold_conversation'
  | 'resume_conversation'
  | 'set_ivr_timeout'
  | 'set_failover_target'

export type GeorgeActionPayload =
  | { name: 'set_open_line_mode'; args: { enabled: boolean }; reason: string }
  | {
      name: 'set_harry_toggle'
      args: {
        setting_key: 'auto_reply_enabled' | 'escalation_alerts_enabled'
        enabled: boolean
      }
      reason: string
    }
  | { name: 'hold_conversation'; args: { phone: string }; reason: string }
  | { name: 'resume_conversation'; args: { phone: string }; reason: string }
  | {
      name: 'set_ivr_timeout'
      args: { target: 'schedule' | 'technical'; seconds: number }
      reason: string
    }
  | {
      name: 'set_failover_target'
      args: { target: 'primary' | 'failover'; phone: string }
      reason: string
    }

export type GeorgeChatRequest = {
  message?: string
  confirmation_token?: string
}

export type GeorgeActionPreview = {
  target: string
  before: Record<string, unknown>
  after: Record<string, unknown>
}

export type GeorgeChatResponse = {
  mode: 'message' | 'confirmation_required' | 'executed' | 'error'
  assistant_message: string
  confirmation?: {
    token: string
    expires_at: string
    action_name: GeorgeActionName
    summary: string
    preview: GeorgeActionPreview
  }
}
