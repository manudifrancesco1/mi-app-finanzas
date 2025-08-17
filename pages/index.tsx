// src/pages/index.tsx
import { NextPage } from 'next'
import { useRouter } from 'next/router'
import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import ExpenseModal from '../src/components/ExpenseModal'
import IncomeModal from '../src/components/IncomeModal'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CurrencyDollarIcon,
  PlusIcon,
  MinusIcon
} from '@heroicons/react/24/outline'

// Formatting helpers
const formatARS = (n: number) =>
  n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  const label = d.toLocaleString('es-AR', { month: 'long' });
  return label.charAt(0).toUpperCase() + label.slice(1);
};

const Amount: React.FC<{ value: number; negative?: boolean; className?: string }> = ({
  value,
  negative,
  className
}) => {
  const sign = negative ? '-' : '';
  return (
    <span className={`tabular-nums ${negative ? 'text-red-600' : ''} ${className || ''}`}>
      {sign}${formatARS(value)}
    </span>
  );
};

type CategoryAmount = { name: string; total: number }

const Dashboard: NextPage = () => {
  const router = useRouter()
  const [sessionChecked, setSessionChecked] = useState<boolean | null>(null)
  const [loadingData, setLoadingData] = useState(false)
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  const [incomesByCategory, setIncomesByCategory] = useState<CategoryAmount[]>([])
  const [totalIncomes, setTotalIncomes] = useState(0)
  const [devolucionesTotal, setDevolucionesTotal] = useState(0)
  const [fixedExpensesByCategory, setFixedExpensesByCategory] = useState<CategoryAmount[]>([])
  const [totalFixedExpenses, setTotalFixedExpenses] = useState(0)
  const [variableExpensesByCategory, setVariableExpensesByCategory] = useState<CategoryAmount[]>([])
  const [totalVariableExpenses, setTotalVariableExpenses] = useState(0)
  const [variableSubcategoriesByCategory, setVariableSubcategoriesByCategory] = useState<
    Record<string, CategoryAmount[]>
  >({})
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({})
  const [showExpenseModal, setShowExpenseModal] = useState(false)
  const [showIncomeModal, setShowIncomeModal] = useState(false)

  const toggleCategory = (name: string) =>
    setExpandedCategories(prev => ({ ...prev, [name]: !prev[name] }))

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      router.replace('/login');
    } catch (_) {}
  };

  // 1) Comprobar sesión
  useEffect(() => {
    const check = async () => {
      const {
        data: { session }
      } = await supabase.auth.getSession()
      if (!session) router.replace('/login')
      else setSessionChecked(true)
    }
    check()
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) router.replace('/login')
    })
    return () => listener.subscription.unsubscribe()
  }, [router])

  // 2) Fetch datos
  useEffect(() => {
    if (!sessionChecked) return
    const fetchData = async () => {
      setLoadingData(true)
      const {
        data: { session }
      } = await supabase.auth.getSession()
      if (!session) return
      const uid = session.user.id
      const [y, m] = selectedMonth.split('-').map(Number)
      const start = `${y}-${String(m).padStart(2, '0')}-01`
      const lastDay = new Date(y, m, 0).getDate()
      const end = `${y}-${String(m).padStart(2, '0')}-${lastDay}`

      // Ingresos
      const { data: incs } = await supabase
        .from('incomes')
        .select('category:category_id(name),amount')
        .eq('user_id', uid)
        .gte('date', start)
        .lte('date', end)
      const mapInc: Record<string, number> = {}
      incs?.forEach(i => {
        const cat = (i as any).category
        const name = Array.isArray(cat) ? cat[0]?.name : cat?.name
        mapInc[name || '–'] = (mapInc[name || '–'] || 0) + i.amount
      })
      const devol = mapInc['Devolución'] || 0
      delete mapInc['Devolución']
      const incArr = Object.entries(mapInc).map(([n, t]) => ({ name: n, total: t })).sort((a,b) => b.total - a.total)
      setIncomesByCategory(incArr)
      setTotalIncomes(incArr.reduce((s, x) => s + x.total, 0))
      setDevolucionesTotal(devol)

      // Gastos
      const { data: txs } = await supabase
        .from('transactions')
        .select('category:category_id(name),subcategory:subcategory_id(name),amount,expense_mode')
        .eq('user_id', uid)
        .gte('date', start)
        .lte('date', end)
      const fixedMap: Record<string, number> = {}
      const variableMap: Record<string, number> = {}
      const subByCat: Record<string, Record<string, number>> = {}
      const EXCLUDED_FIXED = new Set(['Tarjeta Visa', 'Tarjeta Master'])
      txs?.forEach(t => {
        const cat = Array.isArray((t as any).category)
          ? (t as any).category[0]?.name
          : (t as any).category?.name
        if (t.expense_mode === 'fixed') {
          if (!EXCLUDED_FIXED.has(cat)) {
            fixedMap[cat] = (fixedMap[cat] || 0) + t.amount
          }
        } else {
          variableMap[cat] = (variableMap[cat] || 0) + t.amount
          const sub = (t as any).subcategory
          const subName = Array.isArray(sub) ? sub[0]?.name : sub?.name
          if (subName) {
            subByCat[cat] = subByCat[cat] || {}
            subByCat[cat][subName] = (subByCat[cat][subName] || 0) + t.amount
          }
        }
      })
      const toArr = (m: Record<string, number>) => Object.entries(m).map(([n, t]) => ({ name: n, total: t }))
      const fixedArr = toArr(fixedMap).sort((a,b) => b.total - a.total); setFixedExpensesByCategory(fixedArr); setTotalFixedExpenses(fixedArr.reduce((s, x) => s + x.total, 0))
      const varArr   = toArr(variableMap).sort((a,b) => b.total - a.total); setVariableExpensesByCategory(varArr); setTotalVariableExpenses(varArr.reduce((s, x) => s + x.total, 0))
      const subCats: Record<string, CategoryAmount[]> = {}; Object.entries(subByCat).forEach(([c,m])=>subCats[c]=toArr(m).sort((a,b) => b.total - a.total)); setVariableSubcategoriesByCategory(subCats)

      setLoadingData(false)
    }
    fetchData()
  }, [selectedMonth, sessionChecked])

  if (sessionChecked === null) return null

  const netVar = totalVariableExpenses - devolucionesTotal
  const totalExpenses = totalFixedExpenses + netVar
  const balance = totalIncomes - totalExpenses

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 shadow-md bg-white">
        {/* Selector de mes y acciones */}
        <div className="mx-auto max-w-screen-md px-3 py-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-center">
          <div className="flex items-center justify-center gap-3">
            <button
              aria-label="Mes anterior"
              className="p-2 rounded-full hover:bg-gray-100 active:scale-95 transition"
              onClick={() => {
                const [y, m] = selectedMonth.split('-').map(Number)
                const prev = new Date(y, m - 2, 1)
                setSelectedMonth(`${prev.getFullYear()}-${String(prev.getMonth()+1).padStart(2,'0')}`)
              }}
            >
              <ChevronLeftIcon className="h-5 w-5 text-gray-700" />
            </button>

            <span className="text-xl sm:text-2xl font-bold tracking-tight">
              {monthLabel(selectedMonth)}
            </span>

            <button
              aria-label="Mes siguiente"
              className="p-2 rounded-full hover:bg-gray-100 active:scale-95 transition"
              onClick={() => {
                const [y, m] = selectedMonth.split('-').map(Number)
                const next = new Date(y, m, 1)
                setSelectedMonth(`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}`)
              }}
            >
              <ChevronRightIcon className="h-5 w-5 text-gray-700" />
            </button>
          </div>

          
        </div>
      </nav>
      <div className="pt-16">
        {/* Modales */}
        {showExpenseModal && (
          <ExpenseModal
            onClose={() => setShowExpenseModal(false)}
            onSaved={() => { setShowExpenseModal(false); /* recarga data si quieres */ }}
          />
        )}
        {showIncomeModal && (
          <IncomeModal
            onClose={() => setShowIncomeModal(false)}
            onSaved={() => { setShowIncomeModal(false); /* recarga data si quieres */}}
          />
        )}

        {/* Floating action buttons */}
        <div className="fixed right-4 bottom-24 sm:bottom-28 z-40 flex flex-col gap-3">
          <button
            onClick={() => setShowIncomeModal(true)}
            aria-label="Nuevo ingreso"
            className="w-14 h-14 rounded-full bg-green-500 text-white shadow-xl ring-1 ring-black/5 hover:bg-green-600 active:scale-95 transition flex items-center justify-center"
          >
            <PlusIcon className="w-7 h-7" />
          </button>
          <button
            onClick={() => setShowExpenseModal(true)}
            aria-label="Nuevo gasto"
            className="w-14 h-14 rounded-full bg-red-500 text-white shadow-xl ring-1 ring-black/5 hover:bg-red-600 active:scale-95 transition flex items-center justify-center"
          >
            <MinusIcon className="w-7 h-7" />
          </button>
        </div>

        {/* Cards */}
        <main className="p-4 pb-24 grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {/* Balance */}
          <section className="bg-white rounded-2xl shadow-sm p-6 flex flex-col">
            <header className="flex items-center mb-4">
              <CurrencyDollarIcon className="h-6 w-6 text-blue-500 mr-2" />
              <h3 className="text-lg font-semibold">Balance</h3>
            </header>
            <p className={`text-4xl font-bold ${balance<0?'text-red-600':'text-green-600'}`}>
              <Amount value={balance} />
            </p>
          </section>

          {/* Ingresos */}
          <section className="bg-white rounded-2xl shadow-sm p-6 flex flex-col">
            <header className="flex items-center mb-4">
              <ArrowUpIcon className="h-6 w-6 text-green-500 mr-2" />
              <h3 className="text-lg font-semibold">Ingresos</h3>
            </header>
            <p className="text-3xl font-bold mb-4"><Amount value={totalIncomes} /></p>
            <ul className="divide-y space-y-1">
              {incomesByCategory.map(cat => (
                <li key={cat.name} className="py-1 flex justify-between text-sm">
                  <span>{cat.name}</span>
                  <Amount className="text-right" value={cat.total} />
                </li>
              ))}
              {devolucionesTotal>0 && (
                <li className="py-1 flex justify-between text-sm text-red-600">
                  <span>Devoluciones</span>
                  <Amount className="text-right" value={devolucionesTotal} negative />
                </li>
              )}
            </ul>
          </section>

          {/* Gastos Fijos */}
          <section className="bg-white rounded-2xl shadow-sm p-6 flex flex-col">
            <header className="flex items-center mb-4">
              <ArrowDownIcon className="h-6 w-6 text-red-500 mr-2" />
              <h3 className="text-lg font-semibold">Gastos Fijos</h3>
            </header>
            <p className="text-3xl font-bold mb-4"><Amount value={totalFixedExpenses} /></p>
            <ul className="divide-y space-y-1">
              {fixedExpensesByCategory.map(cat => (
                <li key={cat.name} className="py-1 flex justify-between text-sm">
                  <span>{cat.name}</span>
                  <Amount className="text-right" value={cat.total} />
                </li>
              ))}
            </ul>
          </section>

          {/* Gastos Variables */}
          <section className="bg-white rounded-2xl shadow-sm p-6 flex flex-col">
            <header className="flex items-center mb-4">
              <ArrowDownIcon className="h-6 w-6 text-orange-500 mr-2" />
              <h3 className="text-lg font-semibold">Gastos Variables</h3>
            </header>
            <p className="text-3xl font-bold mb-4"><Amount value={totalVariableExpenses} /></p>
            <ul className="divide-y space-y-1">
              {variableExpensesByCategory.map(cat => (
                <li key={cat.name}>
                  <button
                    onClick={() => toggleCategory(cat.name)}
                    className="w-full flex justify-between text-sm py-1"
                  >
                    <span>{cat.name}</span>
                    <Amount className="text-right" value={cat.total} />
                  </button>
                  {expandedCategories[cat.name] && variableSubcategoriesByCategory[cat.name] && (
                    <ul className="pl-4 space-y-1">
                      {variableSubcategoriesByCategory[cat.name].map(sub => (
                        <li key={sub.name} className="flex justify-between text-xs py-1">
                          <span className="italic">{sub.name}</span>
                          <Amount className="text-right" value={sub.total} />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </main>
        <div className="py-3 text-center">
          <button onClick={handleLogout} className="text-gray-400 text-xs underline">
            Cerrar sesión
          </button>
        </div>
      </div>
    </>
  )
}

export default Dashboard
