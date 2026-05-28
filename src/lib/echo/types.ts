// Echo V1 shared types

export type EchoSettings = {
  id: number
  enabled: boolean
  auto_post: boolean
  google_enabled: boolean
  facebook_enabled: boolean
  weekly_cap: number
  skip_repeat_days: number
  updated_at: string
}

export const ECHO_STYLES = [
  'before_after',
  'the_challenge',
  'educational',
  'local_shoutout',
  'the_result',
  'myth_buster',
] as const
export type EchoStyle = (typeof ECHO_STYLES)[number]

export type DecisionAction = 'auto_post' | 'draft' | 'map_only' | 'skip'

export type Decision = {
  action: DecisionAction
  reason: string
}

export type Channel = 'google' | 'facebook'

export type DeliveryResult = {
  channel: Channel
  status: 'success' | 'failed' | 'skipped'
  reason?: string
}

export type EchoDraft = {
  id: string
  job_id: string | null
  post_type: string
  title: string | null
  body: string
  image_url: string | null
  style: string | null
  status: string
  skip_reason: string | null
  context_data: Record<string, unknown> | null
  posted_at: string | null
  created_at: string
}

export type EchoJobContext = {
  id: string
  slug: string
  city: string | null
  neighborhood: string | null
  service_name: string
  line_item_names: string[]
  image_url: string | null
  ai_description: string | null
  published_at: string | null
}
