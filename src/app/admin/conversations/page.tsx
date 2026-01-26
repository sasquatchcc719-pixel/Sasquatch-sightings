import { createAdminClient } from '@/supabase/server'
import { ConversationsView } from '@/components/admin/conversations-view'

export default async function ConversationsPage() {
  const supabase = createAdminClient()

  // Fetch all conversations with linked lead info
  const { data: conversations, error } = await supabase
    .from('conversations')
    .select(`
      *,
      lead:leads(id, name, source, status)
    `)
    .order('updated_at', { ascending: false })

  if (error) {
    console.error('Error fetching conversations:', error)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">AI Dispatcher Conversations</h1>
        <p className="text-muted-foreground">
          Monitor and manage SMS conversations handled by AI
        </p>
      </div>

      <ConversationsView conversations={conversations || []} />
    </div>
  )
}
