function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function buildVoicemailEmail({
  phone,
  transcript,
  conversationUrl,
}: {
  phone: string
  transcript: string
  conversationUrl: string
}) {
  const displayPhone = phone.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3')
  return {
    subject: `New voicemail from ${displayPhone}`,
    text: [
      'New voicemail',
      `From: ${displayPhone}`,
      `Call back: tel:${phone}`,
      '',
      'Voicemail transcript',
      transcript,
      '',
      `Listen to the recording: ${conversationUrl}`,
    ].join('\n'),
    html: `<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;background:#f3f5f2;font-family:Arial,sans-serif;color:#17251b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f5f2;"><tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #dce5dc;border-radius:16px;"><tr><td style="padding:28px 24px;">
      <p style="margin:0 0 10px;color:#166534;font-size:14px;font-weight:bold;">Sasquatch Carpet Cleaning</p>
      <h1 style="margin:0 0 20px;font-size:28px;line-height:1.2;">New voicemail</h1>
      <a href="tel:${escapeHtml(phone)}" style="display:inline-block;padding:16px 20px;background:#166534;color:#ffffff;border-radius:8px;font-size:18px;font-weight:bold;line-height:1.3;text-decoration:none;">Call back ${escapeHtml(displayPhone)}</a>
      <h2 style="margin:28px 0 12px;font-size:18px;">Voicemail transcript</h2>
      <p style="margin:0;font-size:18px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;">${escapeHtml(transcript)}</p>
      <p style="margin:24px 0 0;font-size:16px;"><a href="${escapeHtml(conversationUrl)}" style="color:#166534;font-weight:bold;">Listen to the recording</a></p>
    </td></tr></table>
  </td></tr></table>
</body></html>`,
  }
}
