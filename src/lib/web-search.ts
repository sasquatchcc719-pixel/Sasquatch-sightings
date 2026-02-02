/**
 * Web Search and Scraping utilities for Harry
 * Uses SERP API for Google searches and Jina Reader for page content
 */

const SERP_API_KEY = process.env.SERP_API_KEY

// Search Google using SERP API
export async function searchGoogle(
  query: string,
  numResults = 5,
): Promise<SearchResult[]> {
  if (!SERP_API_KEY) {
    throw new Error('SERP_API_KEY not configured')
  }

  const response = await fetch(`https://google.serper.dev/search`, {
    method: 'POST',
    headers: {
      'X-API-KEY': SERP_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      q: query,
      num: numResults,
    }),
  })

  if (!response.ok) {
    throw new Error(`SERP API error: ${response.status}`)
  }

  const data = await response.json()

  const results: SearchResult[] = []

  // Organic results
  if (data.organic) {
    for (const item of data.organic.slice(0, numResults)) {
      results.push({
        title: item.title,
        url: item.link,
        snippet: item.snippet,
        source: 'google',
      })
    }
  }

  // Knowledge graph if available
  if (data.knowledgeGraph) {
    results.unshift({
      title: data.knowledgeGraph.title || 'Knowledge Panel',
      url: data.knowledgeGraph.website || '',
      snippet: data.knowledgeGraph.description || '',
      source: 'knowledge_graph',
      extra: {
        rating: data.knowledgeGraph.rating,
        reviewCount: data.knowledgeGraph.reviewCount,
        type: data.knowledgeGraph.type,
        address: data.knowledgeGraph.address,
        phone: data.knowledgeGraph.phone,
      },
    })
  }

  return results
}

// Read a webpage using Jina Reader (free, no API key needed)
export async function readWebpage(url: string): Promise<string> {
  const jinaUrl = `https://r.jina.ai/${url}`

  const response = await fetch(jinaUrl, {
    headers: {
      Accept: 'text/plain',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to read page: ${response.status}`)
  }

  const content = await response.text()

  // Limit content length to avoid token overflow
  const maxLength = 8000
  if (content.length > maxLength) {
    return content.substring(0, maxLength) + '\n\n[Content truncated...]'
  }

  return content
}

// Search for competitor reviews
export async function searchCompetitorReviews(
  competitorName: string,
  location = 'Colorado Springs CO',
): Promise<SearchResult[]> {
  const queries = [
    `${competitorName} reviews ${location}`,
    `${competitorName} Google reviews`,
    `${competitorName} Yelp`,
  ]

  const allResults: SearchResult[] = []

  for (const query of queries) {
    try {
      const results = await searchGoogle(query, 3)
      allResults.push(...results)
    } catch (error) {
      console.error(`Search failed for "${query}":`, error)
    }
  }

  return allResults
}

// Search for competitor pricing
export async function searchCompetitorPricing(
  competitorName: string,
): Promise<SearchResult[]> {
  const queries = [
    `${competitorName} pricing`,
    `${competitorName} cost carpet cleaning`,
    `${competitorName} specials promotions`,
  ]

  const allResults: SearchResult[] = []

  for (const query of queries) {
    try {
      const results = await searchGoogle(query, 3)
      allResults.push(...results)
    } catch (error) {
      console.error(`Search failed for "${query}":`, error)
    }
  }

  return allResults
}

// Full competitor research
export async function researchCompetitor(
  competitorName: string,
  website?: string,
): Promise<CompetitorResearch> {
  const research: CompetitorResearch = {
    name: competitorName,
    searchedAt: new Date().toISOString(),
    reviews: [],
    pricing: [],
    websiteContent: null,
  }

  // Search for reviews
  try {
    research.reviews = await searchCompetitorReviews(competitorName)
  } catch (error) {
    console.error('Review search failed:', error)
  }

  // Search for pricing
  try {
    research.pricing = await searchCompetitorPricing(competitorName)
  } catch (error) {
    console.error('Pricing search failed:', error)
  }

  // Read their website if provided
  if (website) {
    try {
      research.websiteContent = await readWebpage(website)
    } catch (error) {
      console.error('Website read failed:', error)
    }
  }

  return research
}

// Types
export interface SearchResult {
  title: string
  url: string
  snippet: string
  source: string
  extra?: {
    rating?: number
    reviewCount?: number
    type?: string
    address?: string
    phone?: string
  }
}

export interface CompetitorResearch {
  name: string
  searchedAt: string
  reviews: SearchResult[]
  pricing: SearchResult[]
  websiteContent: string | null
}
