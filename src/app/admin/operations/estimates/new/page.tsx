import { redirect } from 'next/navigation'

export default function NewEstimatePage() {
  redirect('/admin/operations/new-job?mode=estimate')
}
