#!/usr/bin/env node
/** Google Search Console OAuth — mint a refresh token.
 *  Usage: node scripts/gsc-auth.mjs url [--full]   |   node scripts/gsc-auth.mjs exchange "CODE" [--full]
 *  --full requests the full webmasters scope (needed for sitemap resubmit);
 *  default is read-only. Reuses the Ranger OAuth client (same one used for
 *  Gmail). Separate token. */
import { config } from 'dotenv'
import { google } from 'googleapis'
config({ path: '.env.local' })

const FULL = process.argv.includes('--full')
const SCOPES = [
  FULL
    ? 'https://www.googleapis.com/auth/webmasters'
    : 'https://www.googleapis.com/auth/webmasters.readonly',
]
const REDIRECT_URI = 'https://developers.google.com/oauthplayground'

function client() {
  const id = process.env.RANGER_GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID
  const secret =
    process.env.RANGER_GMAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET
  if (!id || !secret) throw new Error('Missing OAuth client id/secret in .env.local')
  return new google.auth.OAuth2(id, secret, REDIRECT_URI)
}

const [, , cmd, code] = process.argv
if (cmd === 'url') {
  const url = client().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    login_hint: process.env.RANGER_GMAIL_USER || undefined,
  })
  console.log('\nConsent URL (sign in as sasquatchcc719@gmail.com):\n')
  console.log(url)
} else if (cmd === 'exchange') {
  const { tokens } = await client().getToken(code)
  console.log('refresh token present:', Boolean(tokens.refresh_token))
  if (tokens.refresh_token) console.log(tokens.refresh_token)
} else {
  console.log('usage: node scripts/gsc-auth.mjs url | exchange "CODE"')
}
