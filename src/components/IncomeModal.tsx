// src/components/IncomeModal.tsx
import { supabase } from '../lib/supabaseClient'
import { useState } from 'react'

type Props = {
  onClose: () => void
  onSaved: () => void
  initial?: IncomeForm
}

export type IncomeForm = {
  id?: number
  amount: string
  date: string
  description?: string
  category_id?: number
}

const IncomeModal = ({ onClose, onSaved, initial }: Props) => {
  const [form, setForm] = useState<IncomeForm>(
    initial || { amount: '', date: '', description: '', category_id: undefined }
  )

  const handleDelete = async () => {
    if (!initial?.id) return
    const confirm = window.confirm('¿Estás seguro de eliminar este ingreso?')
    if (!confirm) return

    const { error } = await supabase.from('incomes').delete().eq('id', initial.id)
    if (error) {
      console.error(error)
      alert('Error al eliminar el ingreso')
    } else {
      onSaved()
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const payload = {
      amount: parseFloat(form.amount),
      date: form.date,
      description: form.description,
      category_id: form.category_id,
    }

    if (initial?.id) {
      await supabase.from('incomes').update(payload).eq('id', initial.id)
    } else {
      await supabase.from('incomes').insert({ ...payload })
    }

    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg w-full max-w-md">
        <h2 className="text-xl font-semibold mb-4">
          {initial?.id ? 'Editar ingreso' : 'Nuevo ingreso'}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="number"
            step="0.01"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            placeholder="Monto"
            className="w-full border rounded px-3 py-2"
            required
          />
          <input
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            className="w-full border rounded px-3 py-2"
            required
          />
          <input
            type="text"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Descripción"
            className="w-full border rounded px-3 py-2"
          />
          <div className="flex justify-between mt-6">
            {initial?.id && (
              <button
                type="button"
                onClick={handleDelete}
                className="text-red-600 hover:underline"
              >
                Eliminar
              </button>
            )}
            <div className="flex gap-2 ml-auto">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700"
              >
                Guardar
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

export default IncomeModal
