'use client'

import { Bot, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { Card } from '@/components/ui/card'

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <Card className="overflow-hidden">
      <div className="bg-muted/40 border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <Icon className="h-5 w-5 text-emerald-500" />
          <h2 className="text-lg font-semibold">{title}</h2>
        </div>
      </div>
      <div className="px-6 py-5">{children}</div>
    </Card>
  )
}

function CapabilityList({
  items,
  variant,
}: {
  items: string[]
  variant: 'can' | 'cannot' | 'planned'
}) {
  const icon = {
    can: (
      <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
    ),
    cannot: <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" />,
    planned: <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-400" />,
  }[variant]

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2 text-sm">
          {icon}
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

export function AiCapabilitiesReference() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI Capabilities</h1>
        <p className="text-muted-foreground mt-1">
          What Harry and George can and cannot do. This is your reference so you
          always know the boundaries.
        </p>
      </div>

      <Section title="Harry — Customer SMS Assistant" icon={Bot}>
        <div className="space-y-6">
          <div>
            <h3 className="mb-3 text-sm font-semibold tracking-wide text-emerald-600 uppercase">
              What Harry CAN do
            </h3>
            <CapabilityList
              variant="can"
              items={[
                'Answer customer texts automatically on inbound SMS',
                'Give carpet cleaning quotes using the pricing guide',
                'Collect customer info (name, email, address)',
                'Book jobs directly in Ops (search catalog, check availability, create appointment + invoice)',
                'Reschedule existing appointments (checks real availability, verifies phone ownership)',
                'Update service address on existing jobs (verifies phone ownership)',
                'Create leads from SMS conversations',
                'Detect NFC card / partner referrals and apply discount codes',
                'Escalate emergencies, angry customers, and cancellation requests to Charles',
              ]}
            />
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold tracking-wide text-red-500 uppercase">
              What Harry CANNOT do
            </h3>
            <CapabilityList
              variant="cannot"
              items={[
                'Cancel jobs (escalates to Charles instead)',
                'Access financials, invoices, or revenue data',
                'Change settings or toggles',
                "Edit customer records beyond what's collected in the conversation",
                'Manage the service catalog, availability, or partners',
                "Do anything without a matching tool — if a tool call didn't succeed, Harry will not tell the customer it's done",
              ]}
            />
          </div>

          <p className="text-muted-foreground border-t pt-4 text-sm italic">
            Harry&apos;s toolset is complete for customer-facing work. No
            additions planned.
          </p>
        </div>
      </Section>

      <Section title="George Henderson — Admin Operations Copilot" icon={Bot}>
        <div className="space-y-6">
          <div>
            <h3 className="mb-3 text-sm font-semibold tracking-wide text-emerald-600 uppercase">
              What George CAN do today
            </h3>
            <CapabilityList
              variant="can"
              items={[
                'Read any data via SQL (appointments, invoices, customers, conversations, radar, leads, etc.)',
                'Toggle Harry on/off (auto_reply_enabled, escalation_alerts_enabled)',
                'Update Harry logic profiles (prompt overrides, booking mode)',
                'Update Harry knowledge blocks (content, title, enabled)',
                'Hold / resume SMS conversations (escalate or restore AI)',
                'Update appointment status (booked, confirmed, on_my_way, in_progress, completed, cancelled, pending_approval)',
                'Send customer SMS manually',
                'Set IVR timeouts (schedule, technical)',
                'Set failover phone target',
                'Toggle open line mode (bypass IVR / business hours)',
                'All writes require operator confirmation before execution',
                'Full audit trail on every action',
              ]}
            />
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold tracking-wide text-amber-500 uppercase">
              Recommended additions for George (not yet built)
            </h3>
            <CapabilityList
              variant="planned"
              items={[
                'Reschedule any appointment (admin-level, no phone ownership check)',
                'Update service address on any appointment',
                'Create new booking on behalf of a customer',
                'Update customer details (name, email, phone)',
                'Create / update / delete leads',
                'Manage service catalog (add, edit, reorder, deactivate services)',
                'Manage availability templates and overrides',
                'Update invoice status and payment method',
                'Toggle feature flags currently stuck in env vars (AI dispatcher, SMS tools, QuickBooks sync, analyst, George rollout mode)',
                'Manage partner / vendor records',
                'Trigger lifecycle communications (booking confirmation, on-my-way, job-done)',
                'View and manage the delayed comms queue',
              ]}
            />
          </div>
        </div>
      </Section>
    </div>
  )
}
