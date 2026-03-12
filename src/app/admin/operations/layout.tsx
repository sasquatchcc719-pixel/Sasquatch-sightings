import { OperationsSubnav } from '@/components/admin/ops/operations-subnav'

type OperationsLayoutProps = {
  children: React.ReactNode
}

export default function OperationsLayout({ children }: OperationsLayoutProps) {
  return (
    <div className="space-y-6">
      <OperationsSubnav />
      {children}
    </div>
  )
}
