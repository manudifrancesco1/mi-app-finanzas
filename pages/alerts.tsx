// src/pages/alerts.tsx
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useRouter } from 'next/router'

type Alert = {
  id: number
  category_name: string
  month: string
  triggered_at: string
}

export default function AlertsPage() {
  const router = useRouter()
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [error, setError] = useState<string | null>(null)

  // Cargar alertas del usuario
  const fetchAlerts = async () => {
    const { data, error } = await supabase
      .from('alerts')
      .select(`
        id,
        triggered_at,
        budget:budgets (
          month,
          category:categories ( name )
        )
      `)
      .order('triggered_at', { ascending: false })
    if (error) {
      setError(error.message)
    } else if (data) {
      setAlerts(
        data.map((a: any) => ({
          id: a.id,
          month: a.budget.month,
          category_name: a.budget.category.name,
          triggered_at: a.triggered_at
        }))
      )
    }
  }

  useEffect(() => {
    fetchAlerts()
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="flex gap-4 mb-6">
        <button onClick={() => router.push('/')} className="text-blue-600 hover:underline">
          ← Dashboard
        </button>
        <button onClick={() => router.push('/budgets')} className="text-blue-600 hover:underline">
          ← Presupuestos
        </button>
      </div>

      <h1 className="text-2xl font-semibold mb-4">Alertas de Presupuesto</h1>
      {error && <p className="text-red-500 mb-2">{error}</p>}

      {alerts.length === 0 ? (
        <p className="text-gray-600">No tienes alertas por el momento.</p>
      ) : (
        <ul className="space-y-4">
          {alerts.map(a => (
            <li key={a.id} className="bg-white p-4 rounded shadow flex justify-between">
              <div>
                <div className="font-medium text-red-600">
                  Excediste el presupuesto de <strong>{a.category_name}</strong>
                </div>
                <div className="text-gray-600">Mes: {a.month}</div>
              </div>
              <div className="text-sm text-gray-500">
                {new Date(a.triggered_at).toLocaleString()}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
