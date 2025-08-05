// src/pages/expenses.tsx
import { NextPage } from 'next'
import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import ExpenseModal from '../components/ExpenseModal'

type Tx = {
  id: number
  amount: number
  date: string
  description: string | null
  category: { name: string }
  subcategory: { name: string } | null
}

const Expenses: NextPage = () => {
  const [txs, setTxs] = useState<Tx[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)

  const loadTxs = async () => {
    setError(null)
    const {
      data: { session }
    } = await supabase.auth.getSession()
    if (!session) return
    const uid = session.user.id

    const { data, error } = await supabase
      .from('transactions')
      .select(`
        id,
        amount,
        date,
        description,
        category:category_id(name),
        subcategory:subcategory_id(name)
      `)
      .eq('user_id', uid)
      .order('date', { ascending: false })

    if (error) {
      console.error(error)
      setError(error.message)
    } else if (data) {
      const mapped: Tx[] = data.map(item => {
        const catField = (item as any).category
        const subField = (item as any).subcategory

        const categoryName = Array.isArray(catField)
          ? catField[0]?.name ?? ''
          : catField?.name ?? ''

        const subcategoryName = Array.isArray(subField)
          ? subField[0]?.name ?? null
          : subField?.name ?? null

        return {
          id: item.id,
          amount: item.amount,
          date: item.date,
          description: item.description,
          category: { name: categoryName },
          subcategory: subcategoryName ? { name: subcategoryName } : null
        }
      })
      setTxs(mapped)
    }
  }

  useEffect(() => {
    loadTxs()
  }, [])

  return (
    <main className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Gastos</h1>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-full shadow-sm transition"
        >
          + Agregar Gasto
        </button>
      </div>

      {error && <p className="text-red-600 mb-4">{error}</p>}

      <ul className="space-y-2">
        {txs.map(tx => (
          <li
            key={tx.id}
            className="flex justify-between p-3 bg-white rounded shadow-sm"
          >
            <span className="w-24">{tx.date}</span>
            <span className="flex-1">{tx.category.name}</span>
            <span className="flex-1">{tx.subcategory?.name || '-'}</span>
            <span className="flex-1">{tx.description || '-'}</span>
            <span className="w-24 text-right">${tx.amount.toFixed(2)}</span>
          </li>
        ))}
      </ul>

      {showModal && (
        <ExpenseModal
          onClose={() => setShowModal(false)}
          onSaved={() => {
            setShowModal(false)
            loadTxs()
          }}
        />
      )}
    </main>
  )
}

export default Expenses
