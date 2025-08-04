// src/components/NavBar.tsx
import Link from 'next/link'
import { useRouter } from 'next/router'
import {
  HomeIcon,
  BanknotesIcon,
  ClipboardIcon,
  CurrencyDollarIcon,
  ChartBarIcon,
  Cog6ToothIcon
} from '@heroicons/react/24/outline'

const tabs = [
  { href: '/',           label: 'Inicio',      Icon: HomeIcon },
  { href: '/accounts',   label: 'Cuentas',     Icon: BanknotesIcon },
  { href: '/expenses',   label: 'Gastos',      Icon: ClipboardIcon },
  { href: '/incomes',    label: 'Ingresos',    Icon: CurrencyDollarIcon },
  { href: '/budgets',    label: 'Presupuestos',Icon: ChartBarIcon },
  { href: '/settings',   label: 'Más',         Icon: Cog6ToothIcon }
]

export default function NavBar() {
  const { pathname } = useRouter()

  return (
    <nav className="fixed bottom-0 left-0 w-full bg-white border-t shadow-inner">
      <ul className="flex justify-around">
        {tabs.map(({ href, label, Icon }) => {
          const active = pathname === href
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                className={`flex flex-col items-center py-2 text-xs transition-colors ${
                  active
                    ? 'text-blue-600'
                    : 'text-gray-400 hover:text-blue-500'
                }`}
              >
                <Icon className="h-6 w-6" aria-hidden="true" />
                <span>{label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
