import { createAdminClient } from '@/supabase/server'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Phone, Play, Clock, FileText } from 'lucide-react'

interface VoicemailLog {
  id: string
  recipient_phone: string
  message_content: string
  sent_at: string
  twilio_sid: string
}

export default async function VoicemailsPage() {
  const supabase = createAdminClient()

  // Fetch voicemails from sms_logs
  const { data: voicemails, error } = await supabase
    .from('sms_logs')
    .select('*')
    .eq('message_type', 'voicemail_received')
    .order('sent_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('Error fetching voicemails:', error)
  }

  // Parse voicemail content to extract details
  function parseVoicemail(content: string) {
    // Format: "Voicemail (Xs): transcription | Audio: url"
    const durationMatch = content.match(/Voicemail \((\d+)s\)/)
    const duration = durationMatch ? durationMatch[1] : '?'

    const parts = content.split(' | Audio: ')
    const transcription = parts[0]?.replace(/Voicemail \(\d+s\): /, '') || ''
    const audioUrl = parts[1] || null

    return { duration, transcription, audioUrl }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Voicemails</h1>
        <p className="text-muted-foreground">
          Voicemail recordings from missed calls
        </p>
      </div>

      {!voicemails || voicemails.length === 0 ? (
        <Card className="p-8 text-center">
          <Phone className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
          <p className="text-muted-foreground">No voicemails yet</p>
          <p className="text-muted-foreground mt-2 text-sm">
            When customers leave voicemails, they&apos;ll appear here
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {(voicemails as VoicemailLog[]).map((vm) => {
            const { duration, transcription, audioUrl } = parseVoicemail(
              vm.message_content,
            )
            const date = new Date(vm.sent_at)

            return (
              <Card key={vm.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-3">
                      <Phone className="h-5 w-5 text-green-600" />
                      <a
                        href={`tel:${vm.recipient_phone}`}
                        className="text-lg font-semibold hover:underline"
                      >
                        {vm.recipient_phone}
                      </a>
                      <span className="text-muted-foreground flex items-center gap-1 text-sm">
                        <Clock className="h-4 w-4" />
                        {duration}s
                      </span>
                    </div>

                    <div className="text-muted-foreground text-sm">
                      {date.toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true,
                      })}
                    </div>

                    {transcription && transcription !== 'No transcription' && (
                      <div className="bg-muted mt-3 rounded-lg p-3">
                        <div className="mb-1 flex items-center gap-2 text-sm font-medium">
                          <FileText className="h-4 w-4" />
                          Transcription
                        </div>
                        <p className="text-sm">{transcription}</p>
                      </div>
                    )}
                  </div>

                  {audioUrl && (
                    <Button asChild variant="outline" size="sm">
                      <a
                        href={audioUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Play className="mr-2 h-4 w-4" />
                        Play
                      </a>
                    </Button>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
