import {
  Award,
  Ban,
  BarChart3,
  Bot,
  Briefcase,
  Calendar,
  CreditCard,
  Eye,
  FlaskConical,
  Fuel,
  Link2,
  Mail,
  Map,
  MapPin,
  Megaphone,
  MessageSquare,
  Phone,
  PhoneCall,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Store,
  Tag,
  Target,
  Trophy,
  Truck,
  UserRoundSearch,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { NavigationIconName } from '@/lib/admin-navigation'

const icons: Record<NavigationIconName, LucideIcon> = {
  award: Award,
  ban: Ban,
  'bar-chart': BarChart3,
  bot: Bot,
  briefcase: Briefcase,
  calendar: Calendar,
  'credit-card': CreditCard,
  eye: Eye,
  flask: FlaskConical,
  fuel: Fuel,
  link: Link2,
  mail: Mail,
  map: Map,
  'map-pin': MapPin,
  megaphone: Megaphone,
  'message-square': MessageSquare,
  phone: Phone,
  'phone-call': PhoneCall,
  search: Search,
  send: Send,
  'shield-alert': ShieldAlert,
  'shield-check': ShieldCheck,
  store: Store,
  tag: Tag,
  target: Target,
  trophy: Trophy,
  truck: Truck,
  'user-search': UserRoundSearch,
  users: Users,
}

export function getNavigationIcon(name: NavigationIconName): LucideIcon {
  return icons[name]
}
import { createElement } from 'react'

export function NavigationIcon({
  name,
  className,
}: {
  name: NavigationIconName
  className?: string
}) {
  return createElement(icons[name], { className })
}
