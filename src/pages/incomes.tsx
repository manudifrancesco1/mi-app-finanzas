// src/pages/incomes.tsx
import { NextPage } from 'next'
import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import IncomeModal from '../components/IncomeModal'

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
  const [showModal, setShowModal] = useState(false)

  const loadIncomes = async () => {
    setError(null)
    const {
      data: { session }
    } = await supabase.auth.getSession()
    if (!session) return
    const uid = session.user.id

    const { data, error } = await supabase
      .from('incomes')
      .select(`
        id,
        amount,
        date,
        description,
        category:category_id(name)
      `)
      .eq('user_id', uid)
      .order('date', { ascending: false })

    if (error) {
      console.error(error)
      setError(error.message)
    } else if (data) {
      const mapped: Income[] = data.map(item => {
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
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Ingresos</h1>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-full shadow-sm transition"
        >
          + Agregar Ingreso
        </button>
      </div>

      {error && <p className="text-red-600 mb-4">{error}</p>}

      <ul className="space-y-2">
        {inc.map(i => (
          <li
            key={i.id}
            className="flex justify-between p-3 bg-white rounded shadow-sm"
          >
            <span className="w-24">{i.date}</span>
            <span className="flex-1">{i.category.name}</span>
            <span className="flex-1">{i.description || '-'}</span>
            <span className="w-24 text-right">${i.amount.toFixed(2)}</span>
          </li>
        ))}
      </ul>

      {showModal && (
        <IncomeModal
          onClose={() => setShowModal(false)}
          onSaved={() => {
            setShowModal(false)
            loadIncomes()
          }}
        />
      )}
    </main>
  )
}

export default Incomes
