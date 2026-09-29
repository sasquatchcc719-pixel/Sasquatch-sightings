import 'server-only'
import { z } from 'zod'
import type { CommercialAchInstructions } from './commercial'

const commercialAchInstructionsSchema = z.object({
  beneficiaryName: z.string().trim().min(1).max(200),
  bankName: z.string().trim().min(1).max(200),
  routingNumber: z.string().regex(/^\d{9}$/),
  accountNumber: z.string().regex(/^\d{4,17}$/),
  accountType: z.enum(['Checking', 'Savings']),
  remittanceEmail: z.email(),
})

export function loadCommercialAchInstructions(): CommercialAchInstructions {
  const raw = process.env.COMMERCIAL_ACH_DETAILS_JSON
  if (!raw) throw new Error('Commercial ACH instructions are not configured')
  return commercialAchInstructionsSchema.parse(JSON.parse(raw))
}
