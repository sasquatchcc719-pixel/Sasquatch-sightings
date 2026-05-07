#!/usr/bin/env node

import { config } from 'dotenv'
import { google } from 'googleapis'
import http from 'node:http'
import { execFile } from 'node:child_process'

config({ path: '.env.local' })

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
]

const REDIRECT_URI =
  process.env.RANGER_GMAIL_REDIRECT_URI ||
  'https://developers.google.com/oauthplayground'
const LOCAL_REDIRECT_URI =
  process.env.RANGER_GMAIL_LOCAL_REDIRECT_URI ||
  'http://localhost:53682/oauth2callback'

function getOAuthClient(redirectUri = REDIRECT_URI) {
  const clientId = process.env.RANGER_GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID
  const clientSecret =
    process.env.RANGER_GMAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing RANGER_GMAIL_CLIENT_ID/RANGER_GMAIL_CLIENT_SECRET in .env.local',
    )
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri)
}

function buildAuthUrl(redirectUri = REDIRECT_URI) {
  const oauth2Client = getOAuthClient(redirectUri)
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    include_granted_scopes: true,
    login_hint: process.env.RANGER_GMAIL_USER || undefined,
  })
}

function printAuthUrl() {
  const url = buildAuthUrl()

  console.log('\nOpen this URL while signed in as the Ranger Gmail account:\n')
  console.log(url)
  console.log(
    '\nAfter approving, copy the `code` value from the redirected URL and run:',
  )
  console.log('pnpm ranger:gmail-auth exchange "PASTE_CODE_HERE"\n')
}

function openUrl(url) {
  return new Promise((resolve) => {
    execFile('open', [url], () => resolve())
  })
}

async function runLocalCallbackFlow() {
  const oauth2Client = getOAuthClient(LOCAL_REDIRECT_URI)
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    include_granted_scopes: true,
    login_hint: process.env.RANGER_GMAIL_USER || undefined,
  })

  console.log('\nStarting local callback server at:')
  console.log(LOCAL_REDIRECT_URI)
  console.log('\nIf Google shows redirect_uri_mismatch, add this Authorized redirect URI to the OAuth client:')
  console.log(LOCAL_REDIRECT_URI)
  console.log('\nOpening this URL:\n')
  console.log(url)

  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', LOCAL_REDIRECT_URI)
      const code = requestUrl.searchParams.get('code')
      const error = requestUrl.searchParams.get('error')

      if (error) {
        response.writeHead(400, { 'Content-Type': 'text/plain' })
        response.end(`Google returned error: ${error}`)
        console.error(`Google returned error: ${error}`)
        server.close()
        return
      }

      if (!code) {
        response.writeHead(404, { 'Content-Type': 'text/plain' })
        response.end('Missing OAuth code')
        return
      }

      const { tokens } = await oauth2Client.getToken(code)
      response.writeHead(200, { 'Content-Type': 'text/html' })
      response.end('<h1>Ranger Gmail auth succeeded.</h1><p>You can close this tab.</p>')

      console.log('\nToken exchange succeeded.')
      console.log('Access token present:', Boolean(tokens.access_token))
      console.log('Refresh token present:', Boolean(tokens.refresh_token))

      if (tokens.refresh_token) {
        console.log('\nAdd this as RANGER_GMAIL_REFRESH_TOKEN:\n')
        console.log(tokens.refresh_token)
      } else {
        console.log('\nNo refresh token returned. Re-run and make sure the consent prompt appears.')
      }

      server.close()
    } catch (exchangeError) {
      response.writeHead(500, { 'Content-Type': 'text/plain' })
      response.end(
        exchangeError instanceof Error ? exchangeError.message : 'Exchange failed',
      )
      console.error(exchangeError instanceof Error ? exchangeError.message : exchangeError)
      server.close()
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(53682, resolve)
  })

  await openUrl(url)
}

async function exchangeCode(code) {
  if (!code) {
    throw new Error('Missing authorization code')
  }

  const oauth2Client = getOAuthClient()
  const { tokens } = await oauth2Client.getToken(code)

  console.log('\nToken exchange succeeded.')
  console.log('Access token present:', Boolean(tokens.access_token))
  console.log('Refresh token present:', Boolean(tokens.refresh_token))

  if (!tokens.refresh_token) {
    console.log(
      '\nNo refresh token returned. Re-run the URL step and make sure the consent prompt appears.',
    )
    return
  }

  console.log('\nAdd this as RANGER_GMAIL_REFRESH_TOKEN:\n')
  console.log(tokens.refresh_token)
}

const [, , command, code] = process.argv

try {
  if (command === 'url') {
    printAuthUrl()
  } else if (command === 'local') {
    await runLocalCallbackFlow()
  } else if (command === 'exchange') {
    await exchangeCode(code)
  } else {
    console.log('Usage:')
    console.log('  pnpm ranger:gmail-auth url')
    console.log('  pnpm ranger:gmail-auth local')
    console.log('  pnpm ranger:gmail-auth exchange "AUTH_CODE"')
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
