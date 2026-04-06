'use client'

import { useEffect, useState } from 'react'
import {
  ImagePlay,
  CheckCircle2,
  Clock,
  XCircle,
  Gift,
  CalendarDays,
  Briefcase,
  RefreshCw,
} from 'lucide-react'

interface Summary {
  weekly_posts_sent: number
  weekly_cap: number
  queued_jobs: number
}

interface JobPost {
  id: string
  city: string | null
  neighborhood: string | null
  published_at: string
  social_posted_at: string | null
  image_url: string | null
  ai_description: string | null
  service: { name: string } | null
}

interface PromoPost {
  id: string
  post_type: 'OFFER' | 'EVENT'
  season: string
  year: number
  month: number | null
  quarter: number | null
  title: string
  body: string
  image_url: string | null
  coupon_code: string | null
  offer_start_date: string | null
  offer_end_date: string | null
  social_posted_at: string | null
  created_at: string
}

function StatusBadge({ postedAt }: { postedAt: string | null }) {
  if (postedAt) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-400">
        <CheckCircle2 className="h-3 w-3" />
        Posted {new Date(postedAt).toLocaleDateString()}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-400">
      <Clock className="h-3 w-3" />
      Queued
    </span>
  )
}

export default function SocialPostsPage() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [jobPosts, setJobPosts] = useState<JobPost[]>([])
  const [promoPosts, setPromoPosts] = useState<PromoPost[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'jobs' | 'promos'>('jobs')

  const fetchData = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/social-posts')
      const data = await res.json()
      setSummary(data.summary)
      setJobPosts(data.jobPosts || [])
      setPromoPosts(data.promoPosts || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const postedJobs = jobPosts.filter((j) => j.social_posted_at)
  const queuedJobs = jobPosts.filter((j) => !j.social_posted_at && j.city)
  const skippedJobs = jobPosts.filter((j) => !j.social_posted_at && !j.city)

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 p-2.5">
              <ImagePlay className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Social Posts</h1>
              <p className="text-sm text-slate-400">
                Google Business Profile automation — job updates, offers &amp;
                events
              </p>
            </div>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm text-slate-300 transition hover:bg-white/20 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Summary cards */}
        {summary && (
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-center">
              <div className="text-2xl font-bold text-emerald-400">
                {summary.weekly_posts_sent}
                <span className="text-base text-slate-400">
                  /{summary.weekly_cap}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-400">Posts this week</div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{
                    width: `${Math.min(100, (summary.weekly_posts_sent / summary.weekly_cap) * 100)}%`,
                  }}
                />
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-center">
              <div className="text-2xl font-bold text-amber-400">
                {summary.queued_jobs}
              </div>
              <div className="mt-1 text-xs text-slate-400">Jobs queued</div>
              <div className="mt-2 text-xs text-slate-500">
                Waiting for weekly cap
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-center">
              <div className="text-2xl font-bold text-violet-400">
                {promoPosts.length}
              </div>
              <div className="mt-1 text-xs text-slate-400">
                Promo posts total
              </div>
              <div className="mt-2 text-xs text-slate-500">
                {promoPosts.filter((p) => !p.social_posted_at).length} pending
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
          <button
            onClick={() => setActiveTab('jobs')}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
              activeTab === 'jobs'
                ? 'bg-white/15 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Briefcase className="h-4 w-4" />
            Job Posts ({jobPosts.length})
          </button>
          <button
            onClick={() => setActiveTab('promos')}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
              activeTab === 'promos'
                ? 'bg-white/15 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Gift className="h-4 w-4" />
            Offers &amp; Events ({promoPosts.length})
          </button>
        </div>

        {/* Job Posts Tab */}
        {activeTab === 'jobs' && (
          <div className="space-y-3">
            {loading && (
              <div className="py-12 text-center text-slate-500">Loading...</div>
            )}

            {/* Queued */}
            {queuedJobs.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold tracking-wider text-amber-400 uppercase">
                  Queued — waiting for weekly slot ({queuedJobs.length})
                </h3>
                {queuedJobs.map((job) => (
                  <JobCard key={job.id} job={job} />
                ))}
              </div>
            )}

            {/* Posted */}
            {postedJobs.length > 0 && (
              <div className="space-y-2">
                <h3 className="mt-4 text-xs font-semibold tracking-wider text-emerald-400 uppercase">
                  Posted to Google Business ({postedJobs.length})
                </h3>
                {postedJobs.map((job) => (
                  <JobCard key={job.id} job={job} />
                ))}
              </div>
            )}

            {/* Skipped (no city) */}
            {skippedJobs.length > 0 && (
              <div className="space-y-2">
                <h3 className="mt-4 text-xs font-semibold tracking-wider text-slate-500 uppercase">
                  Skipped — no valid city ({skippedJobs.length})
                </h3>
                {skippedJobs.map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/3 px-4 py-2 opacity-50"
                  >
                    <XCircle className="h-4 w-4 text-slate-500" />
                    <span className="text-sm text-slate-500">
                      {(job.service as any)?.name || 'Job'} — no city data
                    </span>
                    <span className="ml-auto text-xs text-slate-600">
                      {new Date(job.published_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {!loading && jobPosts.length === 0 && (
              <div className="py-12 text-center text-slate-500">
                No published jobs yet. Publish a job to start the feed.
              </div>
            )}
          </div>
        )}

        {/* Promos Tab */}
        {activeTab === 'promos' && (
          <div className="space-y-4">
            {loading && (
              <div className="py-12 text-center text-slate-500">Loading...</div>
            )}

            {promoPosts.map((post) => (
              <PromoCard key={post.id} post={post} />
            ))}

            {!loading && promoPosts.length === 0 && (
              <div className="rounded-xl border border-dashed border-white/10 py-16 text-center">
                <Gift className="mx-auto mb-3 h-8 w-8 text-slate-600" />
                <p className="text-slate-400">
                  No promotional posts generated yet.
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Zapier will trigger the first one when it polls{' '}
                  <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-violet-300">
                    /api/posts/promotional
                  </code>
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function JobCard({ job }: { job: JobPost }) {
  const serviceName = (job.service as any)?.name || 'Carpet Cleaning'
  const location = job.neighborhood
    ? `${job.neighborhood}, ${job.city}`
    : job.city || 'Unknown'

  return (
    <div className="flex gap-3 rounded-xl border border-white/10 bg-white/5 p-4 transition hover:bg-white/8">
      {job.image_url && (
        <img
          src={job.image_url}
          alt={location}
          className="h-16 w-16 flex-shrink-0 rounded-lg object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-white">{serviceName}</span>
          <span className="text-slate-400">·</span>
          <span className="text-sm text-slate-300">{location}</span>
          <StatusBadge postedAt={job.social_posted_at} />
        </div>
        {job.ai_description && (
          <p className="mt-1.5 line-clamp-2 text-xs text-slate-400">
            {job.ai_description}
          </p>
        )}
        <div className="mt-1.5 text-xs text-slate-500">
          Published {new Date(job.published_at).toLocaleDateString()}
        </div>
      </div>
    </div>
  )
}

function PromoCard({ post }: { post: PromoPost }) {
  const isOffer = post.post_type === 'OFFER'
  const icon = isOffer ? Gift : CalendarDays
  const Icon = icon

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5">
      <div className="flex gap-4">
        {post.image_url && (
          <img
            src={post.image_url}
            alt={post.title}
            className="h-24 w-24 flex-shrink-0 rounded-xl object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                isOffer
                  ? 'bg-violet-500/15 text-violet-400'
                  : 'bg-blue-500/15 text-blue-400'
              }`}
            >
              <Icon className="h-3 w-3" />
              {post.post_type}
            </span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-300 capitalize">
              {post.season} {post.year}
            </span>
            <StatusBadge postedAt={post.social_posted_at} />
          </div>

          <h3 className="mt-2 text-base font-semibold text-white">
            {post.title}
          </h3>
          <p className="mt-1 text-sm text-slate-300">{post.body}</p>

          <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
            {post.coupon_code && (
              <span className="rounded bg-white/10 px-2 py-1 font-mono text-amber-300">
                {post.coupon_code}
              </span>
            )}
            {post.offer_start_date && post.offer_end_date && (
              <span>
                {new Date(post.offer_start_date).toLocaleDateString()} —{' '}
                {new Date(post.offer_end_date).toLocaleDateString()}
              </span>
            )}
            <span>
              Generated {new Date(post.created_at).toLocaleDateString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
