import { gmail_v1, google } from 'googleapis'

export type RangerGmailMessage = {
  messageId: string
  threadId: string
  fromEmail: string | null
  fromName: string | null
  subject: string | null
  body: string
  internalDate: string | null
}

export type SendRangerGmailMessageParams = {
  to: string
  subject: string
  body: string
  threadId?: string | null
}

const RANGER_GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
]

function getOAuthClient() {
  const clientId =
    process.env.RANGER_GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID
  const clientSecret =
    process.env.RANGER_GMAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET
  const refreshToken =
    process.env.RANGER_GMAIL_REFRESH_TOKEN || process.env.GOOGLE_REFRESH_TOKEN

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Ranger Gmail OAuth credentials are not configured')
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret)
  auth.setCredentials({ refresh_token: refreshToken })
  return auth
}

function decodeBase64Url(value?: string | null): string {
  if (!value) return ''
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    .toString('utf8')
    .trim()
}

function collectBodyParts(payload: gmail_v1.Schema$MessagePart): string[] {
  const parts: string[] = []

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    parts.push(decodeBase64Url(payload.body.data))
  }

  for (const part of payload.parts || []) {
    parts.push(...collectBodyParts(part))
  }

  if (parts.length === 0 && payload.body?.data) {
    parts.push(decodeBase64Url(payload.body.data))
  }

  return parts.filter(Boolean)
}

function parseFromHeader(value: string | null): {
  fromEmail: string | null
  fromName: string | null
} {
  if (!value) return { fromEmail: null, fromName: null }

  const emailMatch = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  const fromEmail = emailMatch?.[0]?.toLowerCase() || null
  const fromName = value
    .replace(/<[^>]+>/g, '')
    .replace(/"/g, '')
    .trim()

  return {
    fromEmail,
    fromName: fromName || null,
  }
}

export function getDefaultRangerGmailQuery(): string {
  return (
    process.env.RANGER_GMAIL_QUERY ||
    'newer_than:30d -from:sasquatchcc719@gmail.com -from:robot@craigslist.org (from:reply.craigslist.org OR subject:("Carpet Cleaning Technician Position") OR subject:("job application"))'
  )
}

export async function listRangerGmailMessages(limit = 10): Promise<string[]> {
  const auth = getOAuthClient()
  const gmail = google.gmail({ version: 'v1', auth })
  const userId = process.env.RANGER_GMAIL_USER || 'me'
  const response = await gmail.users.messages.list({
    userId,
    q: getDefaultRangerGmailQuery(),
    maxResults: limit,
  })

  return (response.data.messages || [])
    .map((message) => message.id)
    .filter((id): id is string => Boolean(id))
}

export async function getRangerGmailMessage(
  messageId: string,
): Promise<RangerGmailMessage> {
  const auth = getOAuthClient()
  const gmail = google.gmail({ version: 'v1', auth })
  const userId = process.env.RANGER_GMAIL_USER || 'me'
  const response = await gmail.users.messages.get({
    userId,
    id: messageId,
    format: 'full',
  })

  const headers = response.data.payload?.headers || []
  const header = (name: string) =>
    headers.find((item) => item.name?.toLowerCase() === name.toLowerCase())
      ?.value || null
  const from = parseFromHeader(header('from'))
  const body = response.data.payload
    ? collectBodyParts(response.data.payload).join('\n\n')
    : ''

  return {
    messageId,
    threadId: response.data.threadId || messageId,
    fromEmail: from.fromEmail,
    fromName: from.fromName,
    subject: header('subject'),
    body: body || response.data.snippet || '',
    internalDate: response.data.internalDate || null,
  }
}

export async function markRangerGmailMessageProcessed(messageId: string) {
  if (process.env.RANGER_GMAIL_MARK_PROCESSED !== 'true') return

  const auth = getOAuthClient()
  const gmail = google.gmail({ version: 'v1', auth })
  const userId = process.env.RANGER_GMAIL_USER || 'me'
  await gmail.users.messages.modify({
    userId,
    id: messageId,
    requestBody: {
      removeLabelIds: ['UNREAD'],
    },
  })
}

function encodeRfc822Message(params: SendRangerGmailMessageParams): string {
  const from = process.env.RANGER_GMAIL_USER || 'me'
  const message = [
    `To: ${params.to}`,
    `From: ${from}`,
    `Subject: ${params.subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
    '',
    params.body,
  ].join('\r\n')

  return Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export async function sendRangerGmailMessage(
  params: SendRangerGmailMessageParams,
): Promise<string> {
  const auth = getOAuthClient()
  const gmail = google.gmail({ version: 'v1', auth })
  const userId = process.env.RANGER_GMAIL_USER || 'me'
  const response = await gmail.users.messages.send({
    userId,
    requestBody: {
      raw: encodeRfc822Message(params),
      threadId: params.threadId || undefined,
    },
  })

  if (!response.data.id) {
    throw new Error('Gmail did not return a sent message id')
  }

  return response.data.id
}

export { RANGER_GMAIL_SCOPES }
