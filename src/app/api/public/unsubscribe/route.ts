import { NextRequest, NextResponse } from 'next/server'
import { verifyUnsubscribeToken } from '@/lib/ops/unsubscribe-token'
import { unsubscribeEmailMarketing } from '@/lib/ops/email-marketing-preferences'
import { createAdminClient } from '@/supabase/server'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function page(title: string, body: string, status = 200) {
  return new NextResponse(
    `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f4f4f4;color:#222}
main{box-sizing:border-box;background:white;padding:36px;border-radius:12px;max-width:480px;margin:20px;text-align:center;box-shadow:0 2px 12px #0001}
h1{font-size:25px;color:#2d6a4f}p{line-height:1.6}button{background:#2d6a4f;color:white;border:0;padding:14px 20px;font-size:16px;border-radius:7px;cursor:pointer}
</style></head><body><main><p>Sasquatch Carpet Cleaning</p><h1>${title}</h1>${body}</main></body></html>`,
    {
      status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  )
}
function identity(request: NextRequest) {
  const url = new URL(request.url)
  const customerId = url.searchParams.get('cid') || ''
  const token = url.searchParams.get('token') || ''
  if (!UUID.test(customerId) || !token)
    return {
      error: page(
        'Unsubscribe link unavailable',
        '<p>Invalid unsubscribe link. Please email sasquatchcc719@gmail.com for help.</p>',
        400,
      ),
    }
  try {
    if (!verifyUnsubscribeToken(customerId, token))
      return {
        error: page(
          'Unsubscribe link unavailable',
          '<p>This link is invalid. Please email sasquatchcc719@gmail.com for help.</p>',
          403,
        ),
      }
  } catch {
    return {
      error: page(
        'Unable to save your preference',
        '<p>Please try again shortly, or email sasquatchcc719@gmail.com for help.</p>',
        503,
      ),
    }
  }
  return { customerId, token }
}
// Reading a link, including scanner prefetch, must not change preferences.
export async function GET(request: NextRequest) {
  const result = identity(request)
  if (result.error) return result.error
  const action = `/api/public/unsubscribe?cid=${encodeURIComponent(result.customerId!)}&amp;token=${encodeURIComponent(result.token!)}`
  return page(
    'Unsubscribe from marketing',
    `<p>Stop promotional offers and cleaning reminder campaigns sent to this email address.</p><p>Necessary invoices and account emails will remain available.</p><form method="post" action="${action}"><button type="submit">Unsubscribe from marketing</button></form>`,
  )
}
export async function POST(request: NextRequest) {
  const result = identity(request)
  if (result.error) return result.error
  try {
    await unsubscribeEmailMarketing(createAdminClient(), {
      customerId: result.customerId!,
      source: 'unsubscribe_link',
    })
    return page(
      "You've been unsubscribed",
      '<p>You will no longer receive marketing emails from Sasquatch Carpet Cleaning at this address.</p><p>Necessary invoices and account emails remain available.</p>',
    )
  } catch (error) {
    if ((error as { code?: string }).code === 'P0002')
      return page(
        'Unsubscribe link unavailable',
        '<p>This account could not be found. Please email sasquatchcc719@gmail.com for help.</p>',
        404,
      )
    return page(
      'Unable to save your preference',
      '<p>Your unsubscribe could not be confirmed. Please try again shortly, or email sasquatchcc719@gmail.com for help.</p>',
      503,
    )
  }
}
