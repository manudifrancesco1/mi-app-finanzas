// src/pages/expenses.tsx
import { NextPage } from 'next'
import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import ExpenseModal, { ExpenseForm } from '../components/ExpenseModal'

type Tx = {
  id: number
  amount: number
  date: string
  description: string | null
  category_id: number
  subcategory_id: number | null
  category: { name: string }
  subcategory: { name: string } | null
}

const Expenses: NextPage = () => {
  const [txs, setTxs] = useState<Tx[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [selected, setSelected] = useState<ExpenseForm | null>(null)
  const [filterText, setFilterText] = useState('')

  const loadTxs = async () => {
    setError(null)
    const {
      data: { session },
      error: sessionError
    } = await supabase.auth.getSession()
    if (sessionError) {
      console.error(sessionError)
      setError(sessionError.message)
      return
    }
    if (!session) return

    const uid = session.user.id
    const { data, error } = await supabase
      .from('transactions')
      .select(`
        id,
        amount,
        date,
        description,
        category_id,
        subcategory_id,
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
          category_id: item.category_id,
          subcategory_id: item.subcategory_id,
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

  const filteredTxs = txs.filter(tx => {
    const texto = filterText.toLowerCase()
    const fields = [
      tx.date,
      tx.category.name,
      tx.subcategory?.name ?? '',
      tx.description ?? ''
    ]
      .join(' ')
      .toLowerCase()
    return fields.includes(texto)
  })

  return (
    <main className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Gastos</h1>
        <button
          onClick={() => {
            setSelected(null)
            setShowModal(true)
          }}
          className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-full shadow-sm transition"
        >
          + Agregar Gasto
        </button>
      </div>

      <div className="mb-4">
        <input
          type="text"
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
          placeholder="Filtrar por fecha, categoría, subcategoría o descripción…"
          className="w-full px-3 py-2 border rounded shadow-sm focus:outline-none focus:ring"
        />
      </div>

      {error && <p className="text-red-600 mb-4">{error}</p>}

      <ul className="space-y-2">
        {filteredTxs.map(tx => (
          <li
            key={tx.id}
            onClick={() => {
              setSelected({
                id: tx.id,
                category_id: tx.category_id,
                subcategory_id: tx.subcategory_id,
                amount: String(tx.amount),
                date: tx.date,
                description: tx.description || '',
                expense_mode: 'variable',
                payment_type: 'debit',
                installments: '',
                tags: '',
                new_category: tx.category.name,
                new_subcategory: tx.subcategory?.name || ''
              })
              setShowModal(true)
            }}
            className="cursor-pointer flex justify-between p-3 bg-white rounded shadow-sm hover:bg-gray-50 transition"
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
          initial={selected || undefined}
          onClose={() => setShowModal(false)}
          onSaved={() => {
            setShowModal(false)
            loadTxs()
            setFilterText('')
          }}
          onDelete={() => {
            setShowModal(false)
            loadTxs()
            setFilterText('')
          }}
        />
      )}
    </main>
  )
}

export default Expenses
