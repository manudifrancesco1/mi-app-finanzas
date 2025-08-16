// src/pages/transactions.tsx
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useRouter } from 'next/router'

type Transaction = {
  id: number
  category_id: number
  category_name: string
  type: 'income' | 'expense'
  amount: number
  currency: string
  date: string
  description: string | null
  tags: string[]
  payment_method_label: string
  installments_total: number | null
  installments_paid: number | null
}

export default function TransactionsPage() {
  const router = useRouter()
  const [categories, setCategories] = useState<{ id: number; name: string; type: string }[]>([])
  const [methods, setMethods] = useState<{ id: number; label: string; type: string }[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [form, setForm] = useState({
    category_id: 0,
    amount: '',
    date: '',
    description: '',
    tags: '',
    payment_method_id: 0,
    installments_total: '',
  })
  const [error, setError] = useState<string | null>(null)

  // 1) Cargar categorías y métodos de pago
  useEffect(() => {
    const loadData = async () => {
      const { data: catData } = await supabase
        .from('categories')
        .select('id, name, type')
        .order('name', { ascending: true })
      if (catData) setCategories(catData)

      const { data: pmData } = await supabase
        .from('payment_methods')
        .select('id, label, type')
        .order('label', { ascending: true })
      if (pmData) setMethods(pmData)
    }
    loadData()
  }, [])

  // 2) Cargar transacciones con join a categorías y métodos
  const fetchTransactions = async () => {
    const { data, error } = await supabase
      .from('transactions')
      .select(`
        id,
        amount,
        currency,
        date,
        description,
        tags,
        installments_total,
        installments_paid,
        method:payment_methods ( label ),
        category:categories ( id, name, type )
      `)
      .order('date', { ascending: false })

    if (error) {
      setError(error.message)
    } else if (data) {
      const txs: Transaction[] = (data as any[]).map((t) => ({
        id: t.id,
        amount: Number(t.amount),
        currency: t.currency,
        date: t.date.slice(0, 10),
        description: t.description,
        tags: t.tags,
        category_id: t.category.id,
        category_name: t.category.name,
        type: t.category.type,
        payment_method_label: t.method?.label ?? '—',
        installments_total: t.installments_total ?? null,
        installments_paid: t.installments_paid ?? null,
      }))
      setTransactions(txs)
    }
  }

  useEffect(() => {
    fetchTransactions()
  }, [])

  // 3) Manejar cambios de formulario
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  // 4) Agregar nueva transacción
  const handleAdd = async () => {
    setError(null)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setError('Debes iniciar sesión')
      return
    }

    const isCredit = methods.find(m => m.id === Number(form.payment_method_id))?.type === 'credit'
    const values: any = {
      user_id: user.id,
      category_id: form.category_id,
      amount: parseFloat(form.amount),
      date: form.date,
      description: form.description || null,
      tags: form.tags ? form.tags.split(',').map(t => t.trim()) : [],
      payment_method_id: form.payment_method_id || null,
    }
    if (isCredit) {
      values.recurrence = 'installment'
      values.installments_total = parseInt(form.installments_total) || 1
      values.installments_paid = 1
    } else {
      values.recurrence = 'one-off'
      values.installments_total = null
      values.installments_paid = null
    }

    const { error: insertError } = await supabase.from('transactions').insert(values)
    if (insertError) {
      setError(insertError.message)
    } else {
      setForm({
        category_id: 0,
        amount: '',
        date: '',
        description: '',
        tags: '',
        payment_method_id: 0,
        installments_total: '',
      })
      fetchTransactions()
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
      </div>

      <h1 className="text-2xl font-semibold mb-4">Mis Transacciones</h1>
      {error && <p className="text-red-500 mb-2">{error}</p>}

      {/* Formulario */}
      <div className="bg-white p-4 rounded-xl shadow-ios mb-6 grid grid-cols-1 md:grid-cols-6 gap-2">
        <select
          name="category_id"
          value={form.category_id}
          onChange={handleChange}
          className="border p-2 rounded col-span-2"
        >
          <option value={0}>-- Elige categoría --</option>
          {categories.map(cat => (
            <option key={cat.id} value={cat.id}>
              {cat.name} ({cat.type})
            </option>
          ))}
        </select>
        <input
          name="amount"
          type="number"
          placeholder="Monto"
          value={form.amount}
          onChange={handleChange}
          className="border p-2 rounded"
        />
        <input
          name="date"
          type="date"
          value={form.date}
          onChange={handleChange}
          className="border p-2 rounded"
        />
        <select
          name="payment_method_id"
          value={form.payment_method_id}
          onChange={handleChange}
          className="border p-2 rounded col-span-1"
        >
          <option value={0}>-- Método --</option>
          {methods.map(m => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        {methods.find(m => m.id === Number(form.payment_method_id))?.type === 'credit' && (
          <input
            name="installments_total"
            type="number"
            placeholder="Cuotas"
            value={form.installments_total}
            onChange={handleChange}
            className="border p-2 rounded col-span-1"
          />
        )}
        <button
          onClick={handleAdd}
          className="bg-blue-500 text-white py-2 rounded-xl hover:bg-blue-600 transition col-span-1"
        >
          Agregar
        </button>
      </div>

      {/* Listado */}
      <div className="space-y-3">
        {transactions.map(tx => (
          <div
            key={tx.id}
            className="bg-white p-4 rounded-2xl shadow-ios flex justify-between items-center"
          >
            <div>
              <div className="font-medium">
                {tx.category_name} — {tx.payment_method_label} ({tx.type})
              </div>
              <div className="text-gray-600">
                {tx.date} — {tx.description || '—'}
              </div>
            </div>
            <div className="text-right">
              <div className={tx.type === 'expense' ? 'text-red-500' : 'text-green-500'}>
                {tx.amount.toLocaleString()} {tx.currency}
              </div>
              {tx.installments_total && (
                <div className="text-sm text-gray-500">
                  {tx.installments_paid}/{tx.installments_total} cuotas
                </div>
              )}
              {tx.tags.length > 0 && (
                <div className="text-sm text-gray-500">{tx.tags.join(', ')}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
