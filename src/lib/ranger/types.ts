export type RangerApplicantStatus =
  | 'new_applicant'
  | 'needs_screening'
  | 'screening_sent'
  | 'awaiting_reply'
  | 'research_running'
  | 'candidate_report_ready'
  | 'owner_review'
  | 'follow_up_drafting'
  | 'late_stage_contact'
  | 'phone_call_ready'
  | 'interview_scheduled'
  | 'no_show'
  | 'passed'
  | 'hired'
  | 'ghosted'
  | 'outcome_tracking'

export type RangerResearchDepth = 'light' | 'standard' | 'deep'
export type RangerConfidence = 'unknown' | 'low' | 'medium' | 'high'
export type RangerFit = 'unknown' | 'low' | 'medium' | 'medium_high' | 'high'

export type RangerRecommendation =
  | 'pass_hard_miss'
  | 'needs_more_info'
  | 'owner_review'
  | 'continue_screening'
  | 'late_stage_contact'
  | 'ready_for_phone_call'

export type RangerScoreCategory =
  | 'reliability'
  | 'judgment'
  | 'professionalism'
  | 'honesty'
  | 'safety'
  | 'fit'
  | 'communication'
  | 'transportation'
  | 'schedule'
  | 'physical_work'
  | 'experience'

export type RangerCategoryScore = {
  score: number
  label: 'unknown' | 'weak' | 'mixed' | 'solid' | 'strong'
  reasons: string[]
}

export type RangerScorecard = Record<RangerScoreCategory, RangerCategoryScore>

export type RangerApplicant = {
  id: string
  source: string
  source_thread_id: string | null
  status: RangerApplicantStatus
  full_name: string | null
  preferred_name: string | null
  email: string | null
  phone: string | null
  city_area: string | null
  has_reliable_transportation: boolean | null
  has_valid_driver_license: boolean | null
  can_work_nights: boolean | null
  can_work_saturdays: boolean | null
  can_do_physical_work: boolean | null
  relevant_experience: string | null
  availability_notes: string | null
  social_profiles: Array<{ platform: string; url: string; handle?: string }>
  missing_fields: string[]
  hard_requirement_misses: string[]
  next_action: string | null
  follow_up_due_at: string | null
  last_contact_at: string | null
  owner_notes: string | null
  final_decision: string | null
  hired_at: string | null
  passed_at: string | null
  created_at: string
  updated_at: string
}

export type RangerCandidateReport = {
  id: string
  applicant_id: string
  research_depth: RangerResearchDepth
  overall_recommendation: RangerRecommendation
  overall_fit: RangerFit
  identity_confidence: RangerConfidence
  research_confidence: RangerConfidence
  summary: string | null
  strengths: string[]
  concerns: string[]
  missing_information: string[]
  suggested_questions: string[]
  suggested_next_step: string | null
  category_scores: RangerScorecard
  report_payload: Record<string, unknown>
  generated_at: string
  created_at: string
  updated_at: string
}

export type RangerEvidence = {
  id: string
  applicant_id: string
  report_id: string | null
  evidence_type: string
  source_label: string | null
  source_url: string | null
  finding: string
  confidence: 'low' | 'medium' | 'high'
  category: string
  sentiment: 'positive' | 'neutral' | 'concern' | 'red_flag'
  raw_snippet: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export type RangerCommandThread = {
  id: string
  telegram_chat_id: string
  telegram_user_id: string | null
  status: 'active' | 'archived'
  last_applicant_id: string | null
  summary: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type RangerCommandMessage = {
  id: string
  thread_id: string
  applicant_id: string | null
  role: 'owner' | 'assistant' | 'tool' | 'system'
  body: string
  metadata: Record<string, unknown>
  created_at: string
}

export type RangerPendingAction = {
  id: string
  thread_id: string | null
  applicant_id: string | null
  action_type: string
  status:
    | 'pending'
    | 'approved'
    | 'cancelled'
    | 'expired'
    | 'executed'
    | 'failed'
  payload: Record<string, unknown>
  payload_hash: string
  requested_by: string | null
  approved_by: string | null
  cancelled_by: string | null
  expires_at: string
  approved_at: string | null
  cancelled_at: string | null
  executed_at: string | null
  result: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type RangerTask = {
  id: string
  applicant_id: string | null
  task_type: string
  status:
    | 'pending'
    | 'running'
    | 'waiting_for_owner'
    | 'completed'
    | 'failed'
    | 'cancelled'
  priority: 'low' | 'normal' | 'high' | 'urgent'
  due_at: string | null
  locked_at: string | null
  completed_at: string | null
  error_message: string | null
  payload: Record<string, unknown>
  result: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type RangerMessage = {
  id: string
  applicant_id: string | null
  channel: 'gmail' | 'sms' | 'telegram' | 'system'
  direction: 'inbound' | 'outbound' | 'internal'
  subject: string | null
  body: string
  status:
    | 'draft'
    | 'pending_approval'
    | 'approved'
    | 'sent'
    | 'failed'
    | 'logged'
  requires_approval: boolean
  sent_at: string | null
  created_at: string
}

export type RangerOwnerDecision = {
  id: string
  applicant_id: string | null
  report_id: string | null
  decision_type: string
  decision_value: string
  notes: string | null
  actor_email: string | null
  telegram_user_id: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export type RangerOutcome = {
  id: string
  applicant_id: string
  outcome_type: 'pipeline' | 'feedback' | 'employment'
  outcome_label: string
  notes: string | null
  recorded_by: string | null
  recorded_at: string
  metadata: Record<string, unknown>
}

export type RangerAuditEvent = {
  id: string
  applicant_id: string | null
  actor: string
  event_type: string
  event_summary: string
  payload: Record<string, unknown>
  created_at: string
}

export type RangerDashboardData = {
  applicants: RangerApplicant[]
  reports: RangerCandidateReport[]
  evidence: RangerEvidence[]
  messages: RangerMessage[]
  tasks: RangerTask[]
  decisions: RangerOwnerDecision[]
  outcomes: RangerOutcome[]
  auditEvents: RangerAuditEvent[]
  commandThreads: RangerCommandThread[]
  commandMessages: RangerCommandMessage[]
  pendingActions: RangerPendingAction[]
  modelState: {
    brain: string
    worker: string
    fast: string
  }
  insights: Array<{
    applicantId: string
    outcome: string
    fit: string
    recommendation: string
    lesson: string
  }>
  stats: {
    total: number
    hardMisses: number
    awaitingReply: number
    reportsReady: number
    phoneReady: number
    hired: number
    ghosted: number
  }
}
