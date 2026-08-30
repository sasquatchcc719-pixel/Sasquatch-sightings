'use client'

import { Mail, MessageSquare, Phone } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Phone number with Call and Text, plus the email if there is one.
 *
 * Extracted from the invoice screen so every job screen offers the same thing.
 * The number is rendered with tabular figures because it gets read aloud off
 * the screen while dialling.
 */
export function CustomerContact({
  phone,
  email,
  className,
}: {
  phone?: string | null
  email?: string | null
  className?: string
}) {
  return (
    <div className={`space-y-2 text-sm ${className ?? ''}`}>
      {phone ? (
        <div className="flex items-center gap-3">
          <Phone className="text-muted-foreground h-4 w-4 shrink-0" />
          <span className="flex-1 text-base tabular-nums">{phone}</span>
          <Button className="gap-2" asChild>
            <a href={`tel:${phone}`}>
              <Phone className="h-4 w-4" />
              Call
            </a>
          </Button>
          <Button variant="outline" className="gap-2" asChild>
            <a href={`sms:${phone}`}>
              <MessageSquare className="h-4 w-4" />
              Text
            </a>
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground">No phone on file</p>
      )}
      {email ? (
        <div className="text-muted-foreground flex items-center gap-2">
          <Mail className="h-4 w-4 shrink-0" />
          <a href={`mailto:${email}`} className="truncate hover:underline">
            {email}
          </a>
        </div>
      ) : null}
    </div>
  )
}
