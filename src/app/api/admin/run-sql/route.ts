import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        db: {
          schema: 'public',
        },
      },
    )

    // Execute raw SQL using PostgREST's query parameter
    const sql = `
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_system_settings_key ON system_settings(key);
    `

    // Try using the database URL directly with fetch
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          query: sql,
        }),
      },
    )

    if (!response.ok) {
      const error = await response.text()
      return NextResponse.json(
        {
          success: false,
          error,
          message:
            'Auto-creation failed. Please run the SQL manually in Supabase dashboard.',
          sql,
        },
        { status: 500 },
      )
    }

    // Verify table was created
    const { data, error: checkError } = await supabase
      .from('system_settings')
      .select('*')
      .limit(1)

    if (checkError) {
      return NextResponse.json({
        success: false,
        error: checkError.message,
        message: 'Table creation unclear. Please verify in Supabase dashboard.',
        sql,
      })
    }

    return NextResponse.json({
      success: true,
      message: 'system_settings table created successfully!',
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    )
  }
}
