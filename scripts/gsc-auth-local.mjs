import { config } from 'dotenv'
import { google } from 'googleapis'
import http from 'node:http'
import fs from 'node:fs'
config({ path: '.env.local' })

const PORT = 53682
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`
const SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly']

const id = process.env.RANGER_GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID
const secret = process.env.RANGER_GMAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET
const oauth = new google.auth.OAuth2(id, secret, REDIRECT_URI)

const url = oauth.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: SCOPES,
  login_hint: process.env.RANGER_GMAIL_USER || undefined,
})
fs.writeFileSync('/tmp/gsc-consent-url.txt', url)
console.log('CONSENT_URL_READY')

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, REDIRECT_URI)
    const code = u.searchParams.get('code')
    const err = u.searchParams.get('error')
    if (err) { res.writeHead(400); res.end('error: ' + err); console.log('OAUTH_ERROR ' + err); return }
    if (!code) { res.writeHead(404); res.end('no code'); return }
    const { tokens } = await oauth.getToken(code)
    if (tokens.refresh_token) {
      fs.writeFileSync('/tmp/gsc-refresh.txt', tokens.refresh_token)
      console.log('REFRESH_TOKEN_WRITTEN')
    } else {
      console.log('NO_REFRESH_TOKEN')
    }
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<h1>Search Console access granted. You can close this tab.</h1>')
    setTimeout(() => process.exit(0), 500)
  } catch (e) {
    res.writeHead(500); res.end(String(e?.message || e)); console.log('EXCHANGE_FAIL ' + (e?.message||e))
  }
})
server.listen(PORT, () => console.log('LISTENING ' + PORT))
