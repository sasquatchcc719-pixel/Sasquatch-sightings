import { google } from 'googleapis'

const GOOGLE_BUSINESS_SCOPE = 'https://www.googleapis.com/auth/business.manage'
const DEFAULT_BOOK_URL = 'https://sightings.sasquatchcarpet.com/book'

type GoogleBusinessTarget = {
  accountId: string
  locationId: string
}

export type GoogleBusinessPostResult = {
  name?: string
  searchUrl?: string
  topicType?: string
}

export function getGoogleBusinessConfigStatus() {
  const status = {
    hasClientId: Boolean(process.env.GOOGLE_CLIENT_ID),
    hasClientSecret: Boolean(process.env.GOOGLE_CLIENT_SECRET),
    hasRefreshToken: Boolean(process.env.GOOGLE_REFRESH_TOKEN),
    hasAccountId: Boolean(process.env.GOOGLE_ACCOUNT_ID),
    hasLocationId: Boolean(process.env.GOOGLE_LOCATION_ID),
    scope: GOOGLE_BUSINESS_SCOPE,
  }

  return {
    ...status,
    ready:
      status.hasClientId && status.hasClientSecret && status.hasRefreshToken,
    hasPinnedTarget: status.hasAccountId && status.hasLocationId,
  }
}

function getAuthClient() {
  if (
    !process.env.GOOGLE_CLIENT_ID ||
    !process.env.GOOGLE_CLIENT_SECRET ||
    !process.env.GOOGLE_REFRESH_TOKEN
  ) {
    throw new Error(
      'Google Business Profile is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN.',
    )
  }

  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  )

  auth.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
  })

  return auth
}

function cleanResourceId(value: string | undefined, prefix: string) {
  return value?.replace(`${prefix}/`, '').trim()
}

async function resolveGoogleBusinessTarget(
  auth: ReturnType<typeof getAuthClient>,
): Promise<GoogleBusinessTarget> {
  const accountId = cleanResourceId(process.env.GOOGLE_ACCOUNT_ID, 'accounts')
  const locationId = cleanResourceId(
    process.env.GOOGLE_LOCATION_ID,
    'locations',
  )

  if (accountId && locationId) return { accountId, locationId }

  const accountManagement = google.mybusinessaccountmanagement('v1')
  const businessInformation = google.mybusinessbusinessinformation('v1')

  const accountsRes = await accountManagement.accounts.list({ auth })
  const account = accountsRes.data.accounts?.[0]

  if (!account?.name) {
    throw new Error('No Google Business Profile account found for this login.')
  }

  const locationsRes = await businessInformation.accounts.locations.list({
    parent: account.name,
    readMask: 'name,title',
    auth,
  })

  const location = locationsRes.data.locations?.[0]

  if (!location?.name) {
    throw new Error('No Google Business Profile location found for this login.')
  }

  return {
    accountId: account.name.split('/')[1],
    locationId: location.name.split('/')[1],
  }
}

export async function createSightingPost(
  imageUrl: string,
  description = 'Check out this Sasquatch Sighting spotted in the neighborhood.',
): Promise<GoogleBusinessPostResult> {
  try {
    const auth = getAuthClient()
    const { accountId, locationId } = await resolveGoogleBusinessTarget(auth)

    const postUrl = `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/localPosts`
    const tokenResponse = await auth.getAccessToken()
    const accessToken = tokenResponse.token

    if (!accessToken) {
      throw new Error('Failed to generate access token.')
    }

    const postBody: Record<string, unknown> = {
      languageCode: 'en-US',
      summary: description.trim().slice(0, 1500),
      topicType: 'STANDARD',
      callToAction: {
        actionType: 'BOOK',
        url: process.env.GOOGLE_BUSINESS_BOOK_URL || DEFAULT_BOOK_URL,
      },
    }

    if (imageUrl.trim()) {
      postBody.media = [{ mediaFormat: 'PHOTO', sourceUrl: imageUrl.trim() }]
    }

    const response = await fetch(postUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(postBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Google API Error (${response.status}): ${errorText}`)
    }

    const result = (await response.json()) as GoogleBusinessPostResult
    console.log('[google-business] Created Google Business Profile post:', {
      name: result.name,
      topicType: result.topicType,
    })
    return result
  } catch (error) {
    console.error('[google-business] Error creating GBP post:', error)
    throw error
  }
}
