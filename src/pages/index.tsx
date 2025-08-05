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

  // 1) Comprobar sesión en cliente
  useEffect(() => {
    const check = async () => {
      const {
        data: { session }
      } = await supabase.auth.getSession()
      if (!session) {
        router.replace('/mi-app-finanzas/login')
      } else {
        setSessionChecked(true)
      }
    }
    check()

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
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
      const {
        data: { session }
      } = await supabase.auth.getSession()
      if (!session) return
      const uid = session.user.id

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
        {/* Aquí va tu JSX original para mostrar los datos de dashboard,
            gráficos, listas de categorías y botones de navegación */}
      </main>
    </>
  )
}

export default Dashboard
