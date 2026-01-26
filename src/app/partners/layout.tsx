type PartnersLayoutProps = {
  children: React.ReactNode
}

export default function PartnersLayout({ children }: PartnersLayoutProps) {
  // Simple pass-through layout
  // Each page handles its own layout (register page has full-page styling, dashboard has nav)
  return <>{children}</>
}
