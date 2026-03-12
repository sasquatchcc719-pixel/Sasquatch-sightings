import { NextRequest, NextResponse } from 'next/server'
import { getUserWithRole, requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { seedHarryKnowledgeDefaults } from '@/lib/harry/control'

type KnowledgeInput = {
  category_key: string
  title: string
  content: string
  is_enabled: boolean
  sort_order: number
}

function normalizeKnowledgeInput(value: unknown): KnowledgeInput {
  const raw = (value || {}) as Record<string, unknown>
  const sortOrder = Number(raw.sort_order ?? 0)
  return {
    category_key: String(raw.category_key || '').trim(),
    title: String(raw.title || '').trim(),
    content: String(raw.content || ''),
    is_enabled: Boolean(raw.is_enabled),
    sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
  }
}

function isMissingRelationError(message: string | undefined): boolean {
  const normalized = String(message || '').toLowerCase()
  return (
    normalized.includes('does not exist') ||
    normalized.includes('relation') ||
    normalized.includes('schema cache')
  )
}

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    await seedHarryKnowledgeDefaults()
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('harry_knowledge_blocks')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('title', { ascending: true })

    if (error) {
      if (isMissingRelationError(error.message)) {
        return NextResponse.json({ blocks: [] })
      }
      throw error
    }
    return NextResponse.json({ blocks: data || [] })
  } catch (error) {
    console.error('[admin/harry/knowledge][GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load Harry knowledge blocks' },
      { status: 500 },
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const { user } = await getUserWithRole()
    const supabase = createAdminClient()
    const body = await request.json()
    const input = normalizeKnowledgeInput(body)

    if (!input.category_key || !input.title) {
      return NextResponse.json(
        { error: 'category_key and title are required' },
        { status: 400 },
      )
    }

    const { error } = await supabase.from('harry_knowledge_blocks').upsert(
      {
        ...input,
        updated_at: new Date().toISOString(),
        updated_by: user?.id || null,
      },
      { onConflict: 'category_key' },
    )
    if (error) throw error

    const { data: blocks } = await supabase
      .from('harry_knowledge_blocks')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('title', { ascending: true })

    return NextResponse.json({ success: true, blocks: blocks || [] })
  } catch (error) {
    console.error('[admin/harry/knowledge][PUT] Error:', error)
    return NextResponse.json(
      { error: 'Failed to update Harry knowledge block' },
      { status: 500 },
    )
  }
}
