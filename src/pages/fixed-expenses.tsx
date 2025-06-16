// src/pages/fixed-expenses.tsx
import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabaseClient'

export default function FixedExpensesPage() {
  const router = useRouter()
  const [items, setItems] = useState<any[]>([])
  const [month] = useState<string>(new Date().toISOString().slice(0, 7)) // 'YYYY-MM'

  // Carga la lista de gastos fijos programados
  const loadFixed = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    const { data, error } = await supabase
      .from('fixed_expenses')
      .select(`
        id,
        category_id,
        subcategory_id,
        amount,
        label,
        last_paid_month,
        category:categories ( name ),
        subcat:subcategories ( name )
      `)
      .eq('user_id', user.id)

    if (error) {
      console.error('Error loading fixed expenses:', error)
    } else {
      setItems(data || [])
    }
  }

  // Marca un gasto fijo como pagado y genera la transacción
  const markPaid = async (id: number) => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return

    // 1) Actualizar last_paid_month
    await supabase
      .from('fixed_expenses')
      .update({ last_paid_month: month })
      .eq('id', id)

    // 2) Crear transacción automática
    const item = items.find((i) => i.id === id)
    if (item) {
      await supabase.from('transactions').insert({
        user_id: user.id,
        category_id: item.category_id,
        subcategory_id: item.subcategory_id,
        amount: item.amount,
        date: new Date().toISOString().slice(0, 10), // YYYY-MM-DD
        payment_method_id: null,
        description: `Pago fijo: ${item.label}`,
        tags: [],
      })
    }

    // 3) Recargar la lista
    loadFixed()
  }

  useEffect(() => {
    loadFixed()
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <button
        onClick={() => router.push('/')}
        className="mb-4 text-blue-600 hover:underline"
      >
        ← Dashboard
      </button>

      <h1 className="text-2xl font-semibold mb-4">Pagos Fijos ({month})</h1>

      <ul className="space-y-3">
        {items.map((i) => (
          <li
            key={i.id}
            className="bg-white p-4 rounded-2xl shadow-ios flex justify-between items-center"
          >
            <div>
              <div className="font-medium">
                {i.category.name} / {i.subcat.name}
              </div>
              <div className="text-gray-600">Monto: {i.amount}</div>
            </div>
            <button
              disabled={i.last_paid_month === month}
              onClick={() => markPaid(i.id)}
              className={`px-4 py-2 rounded-xl text-white transition ${
                i.last_paid_month === month
                  ? 'bg-gray-300 cursor-default'
                  : 'bg-blue-500 hover:bg-blue-600'
              }`}
            >
              {i.last_paid_month === month ? 'Pagado' : 'Marcar pagado'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
