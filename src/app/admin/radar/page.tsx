import { redirect } from 'next/navigation'

/** Radar moved under Marketing — keep the old URL working. */
export default function RadarRedirectPage() {
  redirect('/admin/marketing/radar')
}
