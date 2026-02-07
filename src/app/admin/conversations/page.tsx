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
  // conversation.source: 'inbound' = direct texts | 'NFC Card' = vendor | 'Business Card' | 'Contest'
  let conversations = allConversations || []
  if (source === 'vendor') {
    // Vendor AI chats: from NFC cards at vendor locations
    conversations = conversations.filter(
      (c) => c.source === 'NFC Card' || c.source === 'nfc_card',
    )
  } else if (source === 'phone') {
    // Direct SMS: people who texted your business number directly (no NFC/contest context)
    conversations = conversations.filter((c) => c.source === 'inbound')
  } else if (source === 'ai_chats') {
    // All AI-initiated chats: vendor + business card + contest (everything except inbound)
    conversations = conversations.filter(
      (c) =>
        c.source &&
        c.source !== 'inbound' &&
        ['NFC Card', 'nfc_card', 'Business Card', 'Contest'].includes(c.source),
    )
  }

  const isVendorView = source === 'vendor'
  const isPhoneView = source === 'phone'
  const isAIChatsView = source === 'ai_chats'
  const title = isVendorView
    ? 'Vendor AI Chats'
    : isPhoneView
      ? 'Direct Texts'
      : isAIChatsView
        ? 'AI Chats (All)'
        : 'All Conversations'
  const subtitle = isVendorView
    ? 'Texts from people who tapped a vendor NFC card'
    : isPhoneView
      ? 'Texts from people who contacted your number directly'
      : isAIChatsView
        ? 'Texts from NFC card taps & contest (vendor, business card, contest)'
        : 'All SMS conversations – use Marketing or Calls dropdown to filter by source'

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
