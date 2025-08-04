// src/pages/expenses.tsx
import { NextPage } from 'next'
import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

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

  const loadTxs = async () => {
    setError(null)
    const {
      data: { session }
    } = await supabase.auth.getSession()
    if (!session) return
    const uid = session.user.id

    const { data, error } = await supabase
      .from('transactions')
      .select(
        `
          id,
          amount,
          date,
          description,
          category:category_id(name),
          subcategory:subcategory_id(name)
        `
      )
      .eq('user_id', uid)
      .order('date', { ascending: false })

    if (error) {
      console.error(error)
      setError(error.message)
    } else if (data) {
      const mapped: Tx[] = data.map(item => {
        // extraemos los campos relacionales como any para evitar errores de tipo
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
      <h1 className="text-2xl font-bold mb-4">Transacciones</h1>
      {error && <p className="text-red-600 mb-4">{error}</p>}
      <ul className="space-y-2">
        {txs.map(tx => (
          <li
            key={tx.id}
            className="flex justify-between p-3 bg-white rounded shadow-sm"
          >
            <span>{tx.date}</span>
            <span>{tx.category.name}</span>
            <span>{tx.subcategory?.name || '-'}</span>
            <span>{tx.description || '-'}</span>
            <span>{tx.amount.toFixed(2)}</span>
          </li>
        ))}
      </ul>
    </main>
  )
}

export default Expenses
