// src/pages/index.tsx
import { NextPage } from 'next'
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
import requireAuth from '../utils/requireAuth'

type CategoryAmount = { name: string; total: number }

const Dashboard: NextPage = () => {
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
  const [variableSubcategoriesByCategory, setVariableSubcategoriesByCategory] = useState<Record<string, CategoryAmount[]>>({})
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({})

  const toggleCategory = (name: string) => {
    setExpandedCategories(prev => ({ ...prev, [name]: !prev[name] }))
  }

  useEffect(() => {
    const fetchData = async () => {
      const { data: { session }, error: sessionErr } = await supabase.auth.getSession()
      if (sessionErr || !session) return
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
          // extraemos nombre de categoría de array o de objeto
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

      // Transacciones (gastos)
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
          // categoría como array o objeto
          const catField = (t as any).category
          const cat = Array.isArray(catField)
            ? catField[0]?.name ?? '–'
            : catField?.name ?? '–'

          if (t.expense_mode === 'fixed') {
            fixedMap[cat] = (fixedMap[cat] || 0) + t.amount
          } else {
            variableMap[cat] = (variableMap[cat] || 0) + t.amount
            // subcategoría como array o objeto
            const subField = (t as any).subcategory
            const subName = Array.isArray(subField)
              ? subField[0]?.name
              : subField?.name
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
  }, [selectedMonth])

  const netVariableExpenses = totalVariableExpenses - devolucionesTotal
  const totalExpenses = totalFixedExpenses + netVariableExpenses
  const balance = totalIncomes - totalExpenses

  return (
    <>
      <LogoutButton />
      <main className="p-4 space-y-8">
        {/* ...resto del JSX sin cambios... */}
      </main>
    </>
  )
}

export default requireAuth(Dashboard)
