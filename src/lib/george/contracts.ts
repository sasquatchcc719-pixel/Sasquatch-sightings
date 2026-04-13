export type GeorgeActionName =
  | 'query_database'
  | 'set_open_line_mode'
  | 'set_harry_toggle'
  | 'hold_conversation'
  | 'resume_conversation'
  | 'set_ivr_timeout'
  | 'set_failover_target'
  | 'update_harry_profile'
  | 'update_harry_knowledge_block'
  | 'update_appointment_status'
  | 'send_customer_sms'

export type GeorgeActionPayload =
  | {
      name: 'query_database'
      args: { sql: string; description: string }
      reason: string
    }
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
  | {
      name: 'update_harry_profile'
      args: {
        profile_key: string
        prompt_overrides: string
        booking_mode?: string
        is_enabled?: boolean
      }
      reason: string
    }
  | {
      name: 'update_harry_knowledge_block'
      args: {
        category_key: string
        content: string
        title?: string
        is_enabled?: boolean
      }
      reason: string
    }
  | {
      name: 'update_appointment_status'
      args: {
        appointment_id: string
        status:
          | 'booked'
          | 'confirmed'
          | 'on_my_way'
          | 'in_progress'
          | 'completed'
          | 'cancelled'
          | 'pending_approval'
      }
      reason: string
    }
  | {
      name: 'send_customer_sms'
      args: { phone: string; message: string }
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
