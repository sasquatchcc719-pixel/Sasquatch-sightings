export function rangerBrainModel() {
  return (
    process.env.RANGER_MODEL_BRAIN ||
    process.env.RANGER_OPENAI_MODEL ||
    'gpt-4o'
  )
}

export function rangerWorkerModel() {
  return process.env.RANGER_MODEL_WORKER || 'gpt-4o-mini'
}

export function rangerFastModel() {
  return process.env.RANGER_MODEL_FAST || 'gpt-4o-mini'
}

export function rangerModelSummary() {
  return {
    brain: rangerBrainModel(),
    worker: rangerWorkerModel(),
    fast: rangerFastModel(),
  }
}
