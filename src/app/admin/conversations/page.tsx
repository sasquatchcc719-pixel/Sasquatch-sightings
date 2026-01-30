import { createAdminClient } from '@/supabase/server'
import { ConversationsView } from '@/components/admin/conversations-view'

interface PageProps {
  searchParams: Promise<{ source?: string }>
}

export default async function ConversationsPage({ searchParams }: PageProps) {
  const params = await searchParams
  const source = params.source
  const supabase = createAdminClient()

  // Fetch all conversations with linked lead info
  let query = supabase
    .from('conversations')
    .select(
      `
      *,
      lead:leads(id, name, source, status)
    `,
    )
    .order('updated_at', { ascending: false })

  const { data: allConversations, error } = await query

  if (error) {
    console.error('Error fetching conversations:', error)
  }

  // Filter by source if specified
  let conversations = allConversations || []
  if (source === 'vendor') {
    // Vendor chats are from NFC Card source
    conversations = conversations.filter(
      (c) => c.lead?.source === 'NFC Card' || c.lead?.source === 'nfc_card',
    )
  }

  const isVendorView = source === 'vendor'
  const title = isVendorView ? 'Vendor AI Chats' : 'AI Dispatcher Conversations'
  const subtitle = isVendorView
    ? 'Conversations from vendor NFC card scans'
    : 'Monitor and manage SMS conversations handled by AI'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="text-muted-foreground">{subtitle}</p>
      </div>

      <ConversationsView conversations={conversations} />
    </div>
  )
}
