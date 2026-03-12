import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

type OpsPlaceholderPageProps = {
  title: string
  description: string
  primaryHref?: string
  primaryLabel?: string
}

export function OpsPlaceholderPage({
  title,
  description,
  primaryHref,
  primaryLabel,
}: OpsPlaceholderPageProps) {
  return (
    <Card className="border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur">
      <h2 className="text-2xl font-semibold">{title}</h2>
      <p className="text-muted-foreground mt-3 max-w-2xl text-sm">
        {description}
      </p>
      {primaryHref && primaryLabel ? (
        <div className="mt-5">
          <Button asChild>
            <Link href={primaryHref}>{primaryLabel}</Link>
          </Button>
        </div>
      ) : null}
    </Card>
  )
}
