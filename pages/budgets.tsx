// src/pages/budgets.tsx
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useRouter } from 'next/router'

type Category = { id: number; name: string; type: string }
type Budget = {
  id: number
  category_id: number
  category_name: string
  month: string
  limit_amount: number
}

export default function BudgetsPage() {
  const router = useRouter()
  const [categories, setCategories] = useState<Category[]>([])
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [form, setForm] = useState({
    category_id: 0,
    month: '',
    limit_amount: ''
  })
  const [error, setError] = useState<string | null>(null)

  // 1) Cargar categorías
  const fetchCategories = async () => {
    const { data, error } = await supabase
      .from('categories')
      .select('id, name, type')
      .order('name', { ascending: true })
    if (!error && data) setCategories(data)
  }

  // 2) Cargar presupuestos
  const fetchBudgets = async () => {
    const { data, error } = await supabase
      .from('budgets')
      .select(`
        id,
        month,
        limit_amount,
        category:categories ( id, name )
      `)
      .order('month', { ascending: false })
    if (error) {
      setError(error.message)
    } else if (data) {
      setBudgets(
        data.map((b: any) => ({
          id: b.id,
          month: b.month,
          limit_amount: b.limit_amount,
          category_id: b.category.id,
          category_name: b.category.name
        }))
      )
    }
  }

  useEffect(() => {
    fetchCategories()
    fetchBudgets()
  }, [])

  // 3) Manejar cambios de formulario
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  // 4) Agregar nuevo presupuesto
  const handleAdd = async () => {
    setError(null)
    const userResp = await supabase.auth.getUser()
    const user = userResp.data.user
    if (!user) {
      setError('Debes iniciar sesión')
      return
    }

    const { error: insertError } = await supabase
      .from('budgets')
      .insert({
        user_id: user.id,
        category_id: form.category_id,
        month: form.month,
        limit_amount: parseFloat(form.limit_amount)
      })

    if (insertError) {
      setError(insertError.message)
    } else {
      setForm({ category_id: 0, month: '', limit_amount: '' })
      fetchBudgets()
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="flex gap-4 mb-6">
        <button onClick={() => router.push('/')} className="text-blue-600 hover:underline">
          ← Dashboard
        </button>
        <button onClick={() => router.push('/categories')} className="text-blue-600 hover:underline">
          ← Categorías
        </button>
        <button onClick={() => router.push('/transactions')} className="text-blue-600 hover:underline">
          ← Transacciones
        </button>
      </div>

      <h1 className="text-2xl font-semibold mb-4">Mis Presupuestos</h1>
      {error && <p className="text-red-500 mb-2">{error}</p>}

      {/* Formulario */}
      <div className="bg-white p-4 rounded shadow mb-6 grid grid-cols-1 md:grid-cols-4 gap-2">
        <select
          name="category_id"
          value={form.category_id}
          onChange={handleChange}
          className="border p-2 rounded col-span-1"
        >
          <option value={0}>-- Elige categoría --</option>
          {categories.map(cat => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
        <input
          name="month"
          type="month"
          value={form.month}
          onChange={handleChange}
          className="border p-2 rounded col-span-1"
        />
        <input
          name="limit_amount"
          type="number"
          placeholder="Límite"
          value={form.limit_amount}
          onChange={handleChange}
          className="border p-2 rounded col-span-1"
        />
        <button
          onClick={handleAdd}
          className="bg-blue-500 text-white py-2 rounded hover:bg-blue-600 transition col-span-1"
        >
          Agregar
        </button>
      </div>

      {/* Listado */}
      <div className="space-y-2">
        {budgets.map(b => (
          <div key={b.id} className="bg-white p-4 rounded shadow flex justify-between items-center">
            <div>
              <div className="font-medium">{b.category_name}</div>
              <div className="text-gray-600">{b.month}</div>
            </div>
            <div className="text-right">{b.limit_amount.toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
