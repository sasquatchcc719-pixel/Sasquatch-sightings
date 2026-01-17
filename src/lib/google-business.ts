import { google } from 'googleapis'

// Initialize API clients
const accountManagement = google.mybusinessaccountmanagement('v1')
const businessInformation = google.mybusinessbusinessinformation('v1')

// Setup Authentication
const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
)

auth.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
})

export async function createSightingPost(
    imageUrl: string,
    description: string = 'Check out this Sasquatch Sighting! 📸 spotted in the neighborhood.'
) {
    try {
        // 1. Get Account ID
        const accountsRes = await accountManagement.accounts.list({ auth })
        const account = accountsRes.data.accounts?.[0]

        if (!account || !account.name) {
            throw new Error('No Google Business Profile account found.')
        }

        // account.name format: "accounts/{accountId}"
        const accountId = account.name.split('/')[1]

        // 2. Get Location ID
        // Note: The parent for businessInformation is the account name
        const locationsRes = await businessInformation.accounts.locations.list({
            parent: account.name,
            readMask: 'name,title',
            auth,
        })

        const location = locationsRes.data.locations?.[0]

        if (!location || !location.name) {
            throw new Error('No location found for this account.')
        }

        // location.name format is likely "locations/{locationId}"
        const locationId = location.name.split('/')[1]

        console.log(`Creating post for Account: ${accountId}, Location: ${locationId}`)

        // 3. Create Post using v4 API (not covered by newer googleapis libraries yet)
        // Legacy Endpoint: https://mybusiness.googleapis.com/v4/accounts/{accountId}/locations/{locationId}/localPosts
        const postUrl = `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/localPosts`

        // Manually get access token
        const tokenResponse = await auth.getAccessToken()
        const accessToken = tokenResponse.token

        if (!accessToken) {
            throw new Error('Failed to generate access token.')
        }

        const postBody = {
            languageCode: 'en-US',
            summary: description,
            topicType: 'STANDARD', // "What's New" post
            media: [
                {
                    mediaFormat: 'PHOTO',
                    sourceUrl: imageUrl,
                },
            ],
            callToAction: {
                actionType: 'LEARN_MORE',
                url: 'https://sasquatchcarpet.com', // Default CTA
            }
        }

        const response = await fetch(postUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(postBody),
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`Google API Error (${response.status}): ${errorText}`)
        }

        const result = await response.json()
        console.log('Successfully created Google Post:', result)
        return result

    } catch (error) {
        console.error('Error creating Google Business Post:', error)
        // We re-throw or handle? 
        // Ideally we don't block the user flow if this fails, but we should log it.
        // Throwing allows route.ts to decide.
        throw error
    }
}
