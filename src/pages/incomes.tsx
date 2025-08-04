// src/pages/incomes.tsx
import { NextPage } from 'next'
import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

type Income = {
  id: number
  amount: number
  date: string
  description: string | null
  category: { name: string }
}

const Incomes: NextPage = () => {
  const [inc, setInc] = useState<Income[]>([])
  const [error, setError] = useState<string | null>(null)

  const loadIncomes = async () => {
    setError(null)
    const {
      data: { session }
    } = await supabase.auth.getSession()
    if (!session) return
    const uid = session.user.id

    const { data, error } = await supabase
      .from('incomes')
      .select(
        `
          id,
          amount,
          date,
          description,
          category:category_id(name)
        `
      )
      .eq('user_id', uid)
      .order('date', { ascending: false })

    if (error) {
      console.error(error)
      setError(error.message)
    } else if (data) {
      const mapped: Income[] = data.map(item => {
        // Supabase returns relational fields as arrays
        const catField = (item as any).category
        const categoryName = Array.isArray(catField)
          ? catField[0]?.name ?? ''
          : catField?.name ?? ''
        return {
          id: item.id,
          amount: item.amount,
          date: item.date,
          description: item.description,
          category: { name: categoryName }
        }
      })
      setInc(mapped)
    }
  }

  useEffect(() => {
    loadIncomes()
  }, [])

  return (
    <main className="p-4">
      <h1 className="text-2xl font-bold mb-4">Ingresos</h1>
      {error && <p className="text-red-600 mb-4">{error}</p>}
      <ul className="space-y-2">
        {inc.map(i => (
          <li
            key={i.id}
            className="flex justify-between p-3 bg-white rounded shadow-sm"
          >
            <span>{i.date}</span>
            <span>{i.category.name}</span>
            <span>{i.description || '-'}</span>
            <span>{i.amount.toFixed(2)}</span>
          </li>
        ))}
      </ul>
    </main>
  )
}

export default Incomes
