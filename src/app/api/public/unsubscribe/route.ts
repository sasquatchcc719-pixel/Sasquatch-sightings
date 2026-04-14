import { NextRequest, NextResponse } from 'next/server'
import { verifyUnsubscribeToken } from '@/lib/ops/drip-campaign'
import { createAdminClient } from '@/supabase/server'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const customerId = url.searchParams.get('cid')
  const token = url.searchParams.get('token')

  if (!customerId || !token) {
    return new NextResponse(errorHtml('Invalid unsubscribe link.'), {
      status: 400,
      headers: { 'Content-Type': 'text/html' },
    })
  }

  if (!verifyUnsubscribeToken(customerId, token)) {
    return new NextResponse(
      errorHtml('This unsubscribe link has expired or is invalid.'),
      {
        status: 403,
        headers: { 'Content-Type': 'text/html' },
      },
    )
  }

  const supabase = createAdminClient()

  await supabase
    .from('ops_customers')
    .update({ email_opt_out: true })
    .eq('id', customerId)

  await supabase
    .from('drip_campaign_enrollments')
    .update({ status: 'unsubscribed', updated_at: new Date().toISOString() })
    .eq('customer_id', customerId)
    .eq('status', 'active')

  return new NextResponse(successHtml(), {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  })
}

function successHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribed</title>
<style>
  body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f4f4f4; }
  .card { background: #fff; padding: 40px; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,.1); text-align: center; max-width: 440px; }
  h1 { color: #2d6a4f; margin-bottom: 12px; }
  p { color: #666; line-height: 1.6; }
</style>
</head>
<body>
  <div class="card">
    <h1>You've been unsubscribed</h1>
    <p>You will no longer receive follow-up emails from Sasquatch Carpet Cleaning.</p>
    <p style="margin-top:16px;color:#999;font-size:13px;">If this was a mistake, just text us at <strong>(719) 358-6137</strong> and we'll fix it.</p>
  </div>
</body>
</html>`
}

function errorHtml(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribe Error</title>
<style>
  body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f4f4f4; }
  .card { background: #fff; padding: 40px; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,.1); text-align: center; max-width: 440px; }
  h1 { color: #c0392b; margin-bottom: 12px; }
  p { color: #666; line-height: 1.6; }
</style>
</head>
<body>
  <div class="card">
    <h1>Oops!</h1>
    <p>${message}</p>
    <p style="margin-top:16px;color:#999;font-size:13px;">Please call us at <strong>(719) 249-8791</strong> if you need help.</p>
  </div>
</body>
</html>`
}
