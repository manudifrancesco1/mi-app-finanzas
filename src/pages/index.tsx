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
  // Selector de mes (YYYY-MM)
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  // Estados
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
      // 1) Obtener sesión
      const { data: { session }, error: sessionErr } = await supabase.auth.getSession()
      if (sessionErr || !session) return
      const uid = session.user.id

      // 2) Rango del mes
      const [year, month] = selectedMonth.split('-').map(Number)
      const start = `${year}-${String(month).padStart(2, '0')}-01`
      const lastDay = new Date(year, month, 0).getDate()
      const end = `${year}-${String(month).padStart(2, '0')}-${lastDay}`

      // 3) Traer ingresos
      const { data: incs, error: incErr } = await supabase
        .from('incomes')
        .select('category:category_id(name),amount')
        .eq('user_id', uid)
        .gte('date', start)
        .lte('date', end)

      if (!incErr && incs) {
        const mapInc: Record<string, number> = {}
        incs.forEach(i => {
          const nm = i.category?.name ?? '–'
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

      // 4) Traer transacciones (gastos)
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
          const cat = t.category?.name ?? '–'
          if (t.expense_mode === 'fixed') {
            fixedMap[cat] = (fixedMap[cat] || 0) + t.amount
          } else {
            variableMap[cat] = (variableMap[cat] || 0) + t.amount
            const subName = t.subcategory?.name
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

  // Cálculos finales
  const netVariableExpenses = totalVariableExpenses - devolucionesTotal
  const totalExpenses = totalFixedExpenses + netVariableExpenses
  const balance = totalIncomes - totalExpenses

  return (
    <>
      {/* Botón de logout fijo */}
      <LogoutButton />

      <main className="p-4 space-y-8">
        {/* Selector de mes */}
        <header className="flex flex-col md:flex-row items-start md:items-center justify-between mb-6">
          <div className="flex items-center space-x-2">
            <button
              onClick={() => {
                const [y, m] = selectedMonth.split('-').map(Number)
                const prev = new Date(y, m - 2, 1)
                setSelectedMonth(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`)
              }}
              className="p-2 rounded hover:bg-gray-100"
            >
              <ChevronLeftIcon className="h-5 w-5" />
            </button>
            <input
              type="month"
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              className="border rounded p-2"
            />
            <button
              onClick={() => {
                const [y, m] = selectedMonth.split('-').map(Number)
                const next = new Date(y, m, 1)
                setSelectedMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`)
              }}
              className="p-2 rounded hover:bg-gray-100"
            >
              <ChevronRightIcon className="h-5 w-5" />
            </button>
          </div>
        </header>

        {/* Cards de resumen */}
        <section className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { label: 'Gastos', icon: <ArrowDownIcon />, color: 'red', value: totalExpenses },
            { label: 'Ingresos', icon: <ArrowUpIcon />, color: 'green', value: totalIncomes },
            { label: 'Saldo', icon: <CurrencyDollarIcon />, color: 'gray', value: balance }
          ].map(({ label, icon, color, value }) => (
            <div
              key={label}
              className="bg-white rounded-xl shadow p-5 flex items-center space-x-4"
            >
              <div className={`p-3 rounded-full bg-${color}-50`}>
                {React.cloneElement(icon, { className: `h-6 w-6 text-${color}-500` })}
              </div>
              <div className="flex-1 flex justify-between items-center">
                <span className="text-sm text-gray-500">{label}</span>
                <span className={`text-2xl font-bold text-${color}-600`}>
                  {value.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}
                </span>
              </div>
            </div>
          ))}
        </section>

        {/* Detalle en dos columnas */}
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Columna Izquierda: Gastos */}
          <div className="space-y-6">
            {/* Gastos Fijos */}
            <div className="bg-white p-4 rounded-xl shadow-sm">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-lg font-semibold">Gastos Fijos</h3>
                <span className="text-xl font-bold text-red-600">
                  {totalFixedExpenses.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}
                </span>
              </div>
              <ul className="space-y-1">
                {fixedExpensesByCategory.map(({ name, total }) => (
                  <li key={name} className="flex justify-between">
                    <span>{name}</span>
                    <span>
                      {total.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Gastos Variables netos */}
            <div className="bg-white p-4 rounded-xl shadow-sm">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-lg font-semibold">Gastos Variables netos</h3>
                <span className="text-xl font-bold text-purple-600">
                  {netVariableExpenses.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}
                </span>
              </div>
              <ul>
                {variableExpensesByCategory.map(({ name, total }) => (
                  <li key={name} className="mb-2">
                    <div
                      onClick={() => toggleCategory(name)}
                      className="flex justify-between items-center cursor-pointer"
                    >
                      <span>{name}</span>
                      <span>
                        {total.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}
                      </span>
                    </div>
                    {expandedCategories[name] && (
                      <ul className="mt-1 pl-6 space-y-1">
                        {variableSubcategoriesByCategory[name]?.map(sub => (
                          <li key={sub.name} className="flex justify-between text-sm text-gray-600">
                            <span>{sub.name}</span>
                            <span>
                              {sub.total.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Columna Derecha: Ingresos y Devoluciones */}
          <div className="space-y-6">
            {/* Ingresos por categoría */}
            <div className="bg-white p-4 rounded-xl shadow-sm">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-lg font-semibold">Ingresos por categoría</h3>
                <span className="text-xl font-bold text-green-600">
                  {totalIncomes.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}
                </span>
              </div>
              <ul className="space-y-1">
                {incomesByCategory.map(({ name, total }) => (
                  <li key={name} className="flex justify-between">
                    <span>{name}</span>
                    <span>
                      {total.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Devoluciones */}
            <div className="bg-white p-4 rounded-xl shadow-sm">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-lg font-semibold">Devoluciones</h3>
                <span className="text-xl font-bold text-teal-600">
                  {devolucionesTotal.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}
                </span>
              </div>
              <ul className="space-y-1">
                <li className="flex justify-between">
                  <span>Devoluciones</span>
                  <span>
                    {devolucionesTotal.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </section>
      </main>
    </>
  )
}

export default requireAuth(Dashboard)
