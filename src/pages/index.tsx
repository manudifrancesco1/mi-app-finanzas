// src/pages/index.tsx
import { NextPage } from 'next'
import { useRouter } from 'next/router'
import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import LogoutButton from '../components/LogoutButton'
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

  const toggleCategory = (name: string) => {
    setExpandedCategories(prev => ({ ...prev, [name]: !prev[name] }))
  }

  // 1) Comprobar sesión en cliente con debug
  useEffect(() => {
    const check = async () => {
      const {
        data: { session }
      } = await supabase.auth.getSession()
      console.log('🔍 session from supabase:', session)
      if (!session) {
        router.replace('/mi-app-finanzas/login')
      } else {
        setSessionChecked(true)
      }
    }
    check()

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      console.log('🌀 auth state changed:', session)
      if (!session) router.replace('/mi-app-finanzas/login')
    })
    return () => {
      listener.subscription.unsubscribe()
    }
  }, [router])

  // 2) Fetch de datos después de confirmar sesión
  useEffect(() => {
    if (!sessionChecked) return

    const fetchData = async () => {
      setLoadingData(true)
      const {
        data: { session }
      } = await supabase.auth.getSession()
      if (!session) return
      const uid = session.user.id
      console.log('Usuario:', uid)

      const [year, month] = selectedMonth.split('-').map(Number)
      const start = `${year}-${String(month).padStart(2, '0')}-01`
      const lastDay = new Date(year, month, 0).getDate()
      const end = `${year}-${String(month).padStart(2, '0')}-${lastDay}`

      // Ingresos
      const { data: incs, error: incErr } = await supabase
        .from('incomes')
        .select('category:category_id(name),amount')
        .eq('user_id', uid)
        .gte('date', start)
        .lte('date', end)
      console.log('Incomes raw:', incs, incErr)

      if (!incErr && incs) {
        const mapInc: Record<string, number> = {}
        incs.forEach(i => {
          const catField = (i as any).category
          const nm = Array.isArray(catField)
            ? catField[0]?.name ?? '–'
            : catField?.name ?? '–'
          mapInc[nm] = (mapInc[nm] || 0) + i.amount
        })
        const devol = mapInc['Devolución'] || 0
        delete mapInc['Devolución']
        const incArr = Object.entries(mapInc)
          .map(([name, total]) => ({ name, total }))
          .sort((a, b) => b.total - a.total)
        setIncomesByCategory(incArr)
        setTotalIncomes(incArr.reduce((sum, x) => sum + x.total, 0))
        setDevolucionesTotal(devol)
      }

      // Gastos / Transacciones
      const { data: txs, error: txErr } = await supabase
        .from('transactions')
        .select('category:category_id(name),subcategory:subcategory_id(name),amount,expense_mode')
        .eq('user_id', uid)
        .gte('date', start)
        .lte('date', end)
      console.log('Transactions raw:', txs, txErr)

      if (!txErr && txs) {
        const fixedMap: Record<string, number> = {}
        const variableMap: Record<string, number> = {}
        const subByCat: Record<string, Record<string, number>> = {}

        txs.forEach(t => {
          const catField = (t as any).category
          const cat = Array.isArray(catField)
            ? catField[0]?.name ?? '–'
            : catField?.name ?? '–'

          if (t.expense_mode === 'fixed') {
            fixedMap[cat] = (fixedMap[cat] || 0) + t.amount
          } else {
            variableMap[cat] = (variableMap[cat] || 0) + t.amount
            const subField = (t as any).subcategory
            const subName = Array.isArray(subField) ? subField[0]?.name : subField?.name
            if (subName) {
              subByCat[cat] = subByCat[cat] || {}
              subByCat[cat][subName] = (subByCat[cat][subName] || 0) + t.amount
            }
          }
        })

        const toArray = (m: Record<string, number>) =>
          Object.entries(m)
            .map(([name, total]) => ({ name, total }))
            .sort((a, b) => b.total - a.total)

        const fixedArr = toArray(fixedMap)
        setFixedExpensesByCategory(fixedArr)
        setTotalFixedExpenses(fixedArr.reduce((sum, x) => sum + x.total, 0))

        const varArr = toArray(variableMap)
        setVariableExpensesByCategory(varArr)
        setTotalVariableExpenses(varArr.reduce((sum, x) => sum + x.total, 0))

        const subCatsByCat: Record<string, CategoryAmount[]> = {}
        Object.entries(subByCat).forEach(([cat, m]) => {
          subCatsByCat[cat] = toArray(m)
        })
        setVariableSubcategoriesByCategory(subCatsByCat)
      }

      setLoadingData(false)
    }

    fetchData()
  }, [selectedMonth, sessionChecked])

  if (sessionChecked === null) return null

  const netVariableExpenses = totalVariableExpenses - devolucionesTotal
  const totalExpenses = totalFixedExpenses + netVariableExpenses
  const balance = totalIncomes - totalExpenses

  return (
    <>
      <LogoutButton />
      <main className="p-4 space-y-8">
        {loadingData ? (
          <p>Cargando datos...</p>
        ) : (
          <>
            {/* Navegación mes */}
            <section className="flex items-center justify-between">
              <ChevronLeftIcon
                className="h-6 w-6 cursor-pointer"
                onClick={() => {
                  const [y, m] = selectedMonth.split('-').map(Number)
                  const prev = new Date(y, m - 2, 1)
                  setSelectedMonth(
                    `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`
                  )
                }}
              />
              <h2 className="text-lg font-semibold">{selectedMonth}</h2>
              <ChevronRightIcon
                className="h-6 w-6 cursor-pointer"
                onClick={() => {
                  const [y, m] = selectedMonth.split('-').map(Number)
                  const next = new Date(y, m, 1)
                  setSelectedMonth(
                    `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`
                  )
                }}
              />
            </section>

            {/* Ingresos */}
            <section className="bg-white p-4 rounded shadow space-y-2">
              <div className="flex items-center space-x-2">
                <ArrowUpIcon className="h-5 w-5 text-green-500" />
                <h3 className="font-medium">Ingresos totales</h3>
                <CurrencyDollarIcon className="h-5 w-5 text-gray-400 ml-auto" />
              </div>
              <p className="text-2xl font-bold">${totalIncomes.toLocaleString()}</p>
              <ul className="divide-y">
                {incomesByCategory.map(cat => (
                  <li key={cat.name} className="py-1 flex justify-between">
                    <span>{cat.name}</span>
                    <span>${cat.total.toLocaleString()}</span>
                  </li>
                ))}
                {devolucionesTotal > 0 && (
                  <li className="py-1 flex justify-between text-red-600">
                    <span>Devoluciones</span>
                    <span>-${devolucionesTotal.toLocaleString()}</span>
                  </li>
                )}
              </ul>
            </section>

            {/* Gastos fijos */}
            <section className="bg-white p-4 rounded shadow space-y-2">
              <div className="flex items-center space-x-2">
                <ArrowDownIcon className="h-5 w-5 text-red-500" />
                <h3 className="font-medium">Gastos fijos</h3>
                <CurrencyDollarIcon className="h-5 w-5 text-gray-400 ml-auto" />
              </div>
              <p className="text-2xl font-bold">${totalFixedExpenses.toLocaleString()}</p>
              <ul className="divide-y">
                {fixedExpensesByCategory.map(cat => (
                  <li key={cat.name} className="py-1 flex justify-between">
                    <span>{cat.name}</span>
                    <span>${cat.total.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </section>

            {/* Gastos variables */}
            <section className="bg-white p-4 rounded shadow space-y-2">
              <div className="flex items-center space-x-2">
                <ArrowDownIcon className="h-5 w-5 text-orange-500" />
                <h3 className="font-medium">Gastos variables</h3>
                <CurrencyDollarIcon className="h-5 w-5 text-gray-400 ml-auto" />
              </div>
              <p className="text-2xl font-bold">${totalVariableExpenses.toLocaleString()}</p>
              {variableExpensesByCategory.map(cat => (
                <div key={cat.name}>
                  <button
                    onClick={() => toggleCategory(cat.name)}
                    className="w-full text-left flex justify-between py-1"
                  >
                    <span>{cat.name}</span>
                    <span>${cat.total.toLocaleString()}</span>
                  </button>
                  {expandedCategories[cat.name] && variableSubcategoriesByCategory[cat.name] && (
                    <ul className="pl-4 divide-y">
                      {variableSubcategoriesByCategory[cat.name].map(sub => (
                        <li key={sub.name} className="py-1 flex justify-between">
                          <span className="italic">{sub.name}</span>
                          <span>${sub.total.toLocaleString()}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </section>

            {/* Balance */}
            <section className="bg-white p-4 rounded shadow space-y-2">
              <div className="flex items-center space-x-2">
                <CurrencyDollarIcon className="h-5 w-5 text-blue-500" />
                <h3 className="font-medium">Balance del mes</h3>
              </div>
              <p
                className={`text-2xl font-bold ${
                  balance < 0 ? 'text-red-600' : 'text-green-600'
                }`}
              >
                ${balance.toLocaleString()}
              </p>
            </section>
          </>
        )}
      </main>
    </>
  )
}

export default Dashboard
