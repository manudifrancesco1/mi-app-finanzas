// src/pages/incomes.tsx
import { NextPage } from 'next'
import React, { useEffect, useState } from 'react'
import { IncomeModal, IncomeForm } from '../components/IncomeModal'
import { supabase } from '../lib/supabaseClient'
import {
  PlusIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline'

type Income = {
  id: number
  amount: number
  date: string
  description: string | null
  category_id: number | null
  category: { name: string } | null
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('es-AR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
  }).format(n)

const IncomesPage: NextPage = () => {
  const [inc, setInc] = useState<Income[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<IncomeForm>()

  // mes seleccionado (YYYY-MM)
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  const load = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return

    const [year, month] = selectedMonth.split('-').map(Number)
    const start = `${year}-${String(month).padStart(2, '0')}-01`
    const lastDay = new Date(year, month, 0).getDate()
    const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

    const { data, error } = await supabase
      .from('incomes')
      .select('id,amount,date,description,category_id,category:category_id(name)')
      .eq('user_id', user.id)
      .gte('date', start)
      .lte('date', end)
      .order('date', { ascending: false })

    if (error) console.error(error)
    else setInc(data || [])
  }

  useEffect(() => {
    load()
  }, [selectedMonth])

  const onSaved = () => {
    setShowModal(false)
    setEditing(undefined)
    load()
  }

  const changeMonth = (delta: number) => {
    const [y, m] = selectedMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setSelectedMonth(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    )
  }

  // agrupar por fecha
  const groups = inc.reduce<Record<string, Income[]>>((acc, item) => {
    ;(acc[item.date] = acc[item.date] || []).push(item)
    return acc
  }, {})

  const sortedDates = Object.keys(groups).sort(
    (a, b) => new Date(b).getTime() - new Date(a).getTime()
  )

  return (
    <div className="w-full min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6">
        <h1 className="text-3xl font-semibold text-gray-800 mb-4 sm:mb-0">
          Ingresos
        </h1>
        <button
          onClick={() => {
            setEditing(undefined)
            setShowModal(true)
          }}
          className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded"
        >
          <PlusIcon className="h-5 w-5" />
          Nuevo
        </button>
      </div>

      {/* Month Picker */}
      <div className="flex items-center space-x-2 mb-8">
        <button
          onClick={() => changeMonth(-1)}
          className="p-2 rounded hover:bg-gray-100"
        >
          <ChevronLeftIcon className="h-5 w-5 text-gray-600" />
        </button>
        <input
          type="month"
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="border rounded px-3 py-2"
        />
        <button
          onClick={() => changeMonth(+1)}
          className="p-2 rounded hover:bg-gray-100"
        >
          <ChevronRightIcon className="h-5 w-5 text-gray-600" />
        </button>
      </div>

      {/* List Grouped by Date */}
      <div className="space-y-10">
        {sortedDates.map((date) => (
          <div key={date}>
            <h2 className="text-lg font-medium text-gray-700 mb-3">
              {formatDate(date)}
            </h2>
            <div className="space-y-3">
              {groups[date].map((i) => (
                <div
                  key={i.id}
                  onClick={() => {
                    setEditing({
                      id: i.id,
                      amount: i.amount.toString(),
                      date: i.date,
                      description: i.description || '',
                      category_id: i.category_id ?? undefined,
                    })
                    setShowModal(true)
                  }}
                  className="flex items-center justify-between w-full bg-white p-4 rounded-lg shadow hover:bg-gray-100 cursor-pointer"
                >
                  <div className="flex-1">
                    <div className="font-medium text-gray-800">
                      {i.category?.name ?? '–'}
                    </div>
                    {i.description && (
                      <div className="text-sm text-gray-500">
                        {i.description}
                      </div>
                    )}
                  </div>
                  <div className="ml-4 text-lg font-semibold text-gray-800">
                    {formatCurrency(i.amount)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Modal */}
      {showModal && (
        <IncomeModal
          onClose={() => setShowModal(false)}
          onSaved={onSaved}
          initial={editing}
        />
      )}
    </div>
  )
}

export default IncomesPage
