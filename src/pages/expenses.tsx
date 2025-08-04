// src/pages/expenses.tsx
import { NextPage } from 'next'
import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import ExpenseModal, { ExpenseForm } from '../components/ExpenseModal'
import {
  PlusIcon,
  ChevronLeftIcon,
  ChevronRightIcon
} from '@heroicons/react/24/outline'

type Tx = {
  id: number
  amount: number
  date: string
  description: string | null
  category: { name: string } | null
  subcategory: { name: string } | null
}

const ExpensesPage: NextPage = () => {
  // Selector de mes
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  const [txs, setTxs] = useState<Tx[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<ExpenseForm>()

  const load = async () => {
    const {
      data: { user }
    } = await supabase.auth.getUser()
    if (!user) return

    // Calcular rango del mes
    const [y, m] = selectedMonth.split('-').map(Number)
    const start = `${y}-${String(m).padStart(2, '0')}-01`
    const lastDay = new Date(y, m, 0).getDate()
    const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

    const { data, error } = await supabase
      .from('transactions')
      .select(`
        id,
        amount,
        date,
        description,
        category:categories(name),
        subcategory:subcategories(name)
      `)
      .eq('user_id', user.id)
      .eq('expense_mode', 'variable')
      .gte('date', start)
      .lte('date', end)
      .order('date', { ascending: false })

    if (error) console.error(error)
    else setTxs(data || [])
  }

  useEffect(() => {
    load()
  }, [selectedMonth])

  const handleSaved = () => {
    setShowModal(false)
    setEditing(undefined)
    load()
  }

  const prevMonth = () => {
    const [y, m] = selectedMonth.split('-').map(Number)
    const prev = new Date(y, m - 2, 1)
    setSelectedMonth(
      `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`
    )
  }
  const nextMonth = () => {
    const [y, m] = selectedMonth.split('-').map(Number)
    const nxt = new Date(y, m, 1)
    setSelectedMonth(
      `${nxt.getFullYear()}-${String(nxt.getMonth() + 1).padStart(2, '0')}`
    )
  }

  // Agrupar por fecha
  const grouped = txs.reduce<Record<string, Tx[]>>((acc, tx) => {
    ;(acc[tx.date] ??= []).push(tx)
    return acc
  }, {} as Record<string, Tx[]>)
  const dates = Object.keys(grouped).sort((a, b) => b.localeCompare(a))

  const onClickTx = (tx: Tx) => {
    setEditing({
      id: tx.id,
      category_id: 0,
      amount: tx.amount.toString(),
      date: tx.date,
      description: tx.description || '',
      payment_type: 'credit',
      installments: '1',
      expense_mode: 'variable'
    })
    setShowModal(true)
  }

  return (
    <div className="p-6">
      {/* selector + botón nuevo */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-4">
        <div className="flex items-center gap-2 mb-2 md:mb-0">
          <button
            onClick={prevMonth}
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
            onClick={nextMonth}
            className="p-2 rounded hover:bg-gray-100"
          >
            <ChevronRightIcon className="h-5 w-5" />
          </button>
        </div>
        <button
          onClick={() => {
            setEditing(undefined)
            setShowModal(true)
          }}
          className="flex items-center gap-1 px-4 py-2 bg-green-600 text-white rounded shadow"
        >
          <PlusIcon className="h-5 w-5" /> Nuevo
        </button>
      </div>

      {dates.map(date => (
        <section key={date} className="mb-6">
          <h2 className="text-gray-600 font-medium mb-2">{date}</h2>
          <ul className="space-y-2">
            {grouped[date].map(tx => {
              const cat = tx.category?.name ?? ''
              const sub = tx.subcategory?.name ?? ''
              return (
                <li
                  key={tx.id}
                  onClick={() => onClickTx(tx)}
                  className="cursor-pointer bg-white p-4 rounded-lg flex justify-between items-center shadow-sm hover:bg-gray-50"
                >
                  <div>
                    {cat && (
                      <div className="text-sm font-medium">{cat}</div>
                    )}
                    {sub && (
                      <div className="text-xs text-gray-500">{sub}</div>
                    )}
                    {tx.description && (
                      <div className="text-xs text-gray-500">
                        {tx.description}
                      </div>
                    )}
                  </div>
                  <div className="text-lg font-semibold">
                    {tx.amount.toLocaleString('es-AR', {
                      style: 'currency',
                      currency: 'ARS'
                    })}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {showModal && (
        <ExpenseModal
          onClose={() => setShowModal(false)}
          onSaved={handleSaved}
          initial={editing}
        />
      )}
    </div>
  )
}

export default ExpensesPage
