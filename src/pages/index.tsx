// src/pages/index.tsx
import { NextPage } from 'next'
import { useRouter } from 'next/router'
import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import LogoutButton from '../components/LogoutButton'
import ExpenseModal from '../components/ExpenseModal'
import IncomeModal from '../components/IncomeModal'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CurrencyDollarIcon
} from '@heroicons/react/24/outline'

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
      const incArr = Object.entries(mapInc).map(([name, total]) => ({ name, total }))
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
      txs?.forEach(t => {
        const cat = Array.isArray((t as any).category)
          ? (t as any).category[0]?.name
          : (t as any).category?.name

        if (t.expense_mode === 'fixed') {
          fixedMap[cat] = (fixedMap[cat] || 0) + t.amount
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

      const toArr = (m: Record<string, number>) =>
        Object.entries(m).map(([n, tot]) => ({ name: n, total: tot }))

      const fixedArr = toArr(fixedMap)
      setFixedExpensesByCategory(fixedArr)
      setTotalFixedExpenses(fixedArr.reduce((s, x) => s + x.total, 0))

      const varArr = toArr(variableMap)
      setVariableExpensesByCategory(varArr)
      setTotalVariableExpenses(varArr.reduce((s, x) => s + x.total, 0))

      const subCats: Record<string, CategoryAmount[]> = {}
      Object.entries(subByCat).forEach(([c, m]) => (subCats[c] = toArr(m)))
      setVariableSubcategoriesByCategory(subCats)

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
      <LogoutButton />

      {/* Selector de mes y acciones */}
      <div className="flex flex-wrap items-center justify-center space-x-4 my-4">
        <ChevronLeftIcon
          className="h-6 w-6 cursor-pointer text-gray-600"
          onClick={() => {
            const [y, m] = selectedMonth.split('-').map(Number)
            const prev = new Date(y, m - 2, 1)
            setSelectedMonth(
              `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`
            )
          }}
        />
        <span className="text-lg font-semibold">{selectedMonth}</span>
        <ChevronRightIcon
          className="h-6 w-6 cursor-pointer text-gray-600"
          onClick={() => {
            const [y, m] = selectedMonth.split('-').map(Number)
            const next = new Date(y, m, 1)
            setSelectedMonth(
              `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`
            )
          }}
        />
        <button
          onClick={() => setShowExpenseModal(true)}
          className="ml-4 px-3 py-1 rounded-full bg-red-500 text-white text-sm shadow-sm hover:bg-red-600 transition"
        >
          + Nuevo Gasto
        </button>
        <button
          onClick={() => setShowIncomeModal(true)}
          className="px-3 py-1 rounded-full bg-green-500 text-white text-sm shadow-sm hover:bg-green-600 transition"
        >
          + Nuevo Ingreso
        </button>
      </div>

      {/* Modales */}
      {showExpenseModal && (
        <ExpenseModal
          onClose={() => setShowExpenseModal(false)}
          onSaved={() => {
            setShowExpenseModal(false)
            /* recarga data aquí si es necesario */
          }}
        />
      )}
      {showIncomeModal && (
        <IncomeModal
          onClose={() => setShowIncomeModal(false)}
          onSaved={() => {
            setShowIncomeModal(false)
            /* recarga data aquí si es necesario */
          }}
        />
      )}

      {/* Cards */}
      <main className="p-4 grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {/* Aquí van tus secciones de Ingresos, Gastos, Balance en cards */}
      </main>
    </>
  )
}

export default Dashboard
