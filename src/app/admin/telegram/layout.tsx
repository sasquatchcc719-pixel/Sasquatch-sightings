import { Fraunces } from 'next/font/google'
import { Suspense } from 'react'
import { TelegramSubnav } from '@/components/admin/telegram/TelegramSubnav'

const display = Fraunces({
  subsets: ['latin'],
  variable: '--font-telegram-display',
  display: 'swap',
})

export default function TelegramLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className={`${display.variable} mx-auto w-full max-w-[1440px]`}>
      <Suspense fallback={null}>
        <TelegramSubnav />
      </Suspense>
      {children}
    </div>
  )
}
