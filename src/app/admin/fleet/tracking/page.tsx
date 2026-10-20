import { redirect } from 'next/navigation'

// Keep existing bookmarks pointed at the single dispatch workspace.
export default function VehicleTrackingPage() {
  redirect('/admin/operations/dispatch')
}
