// src/components/IncomeModal.tsx
import { supabase } from '../lib/supabaseClient'
import { useState, useEffect } from 'react'

export type IncomeForm = {
  id?: number
  amount: string
  date: string
  description?: string
  category_id?: number
}

type Category = {
  id: number
  name: string
}

type Props = {
  onClose: () => void
  onSaved: () => void
  initial?: IncomeForm
}

export function IncomeModal({ onClose, onSaved, initial }: Props) {
  const [form, setForm] = useState<IncomeForm>(
    initial || { amount: '', date: '', description: '', category_id: undefined }
  )
  const [categories, setCategories] = useState<Category[]>([])
  const [addingNew, setAddingNew] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')

  // Función para cargar categorías del usuario
  const loadCategories = async () => {
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()
    if (authErr || !user) {
      console.error('No hay usuario para cargar categorías:', authErr)
      return
    }
    const { data, error } = await supabase
      .from('categories')           // <–– sin genéricos
      .select('id, name')
      .eq('user_id', user.id)
      .order('name', { ascending: true })

    if (error) console.error('Error cargando categorías:', error)
    else setCategories(data || [])
  }

  useEffect(() => {
    loadCategories()
  }, [])

  const handleDelete = async () => {
    if (!initial?.id) return
    if (!window.confirm('¿Estás seguro de eliminar este ingreso?')) return

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

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      console.error('No se pudo obtener el usuario autenticado:', authError)
      return alert('Error interno: no hay usuario autenticado')
    }

    // Primero, si vamos a crear nueva categoría:
    let categoryId = form.category_id
    if (addingNew && newCategoryName.trim()) {
      const { error: catErr } = await supabase
        .from('categories')         // <–– sin genéricos
        .insert({
          name: newCategoryName.trim(),
          user_id: user.id,
        })
      if (catErr) {
        console.error('Error al crear categoría:', catErr)
        return alert('Error al crear categoría')
      }
      // recargo lista y busco la categoría recién creada
      await loadCategories()
      const found = categories.find((c) => c.name === newCategoryName.trim())
      if (found) {
        categoryId = found.id
      } else {
        console.warn('Categoría creada pero no encontrada en recarga')
      }
    }

    const payload = {
      amount: parseFloat(form.amount),
      date: form.date,
      description: form.description,
      category_id: categoryId,
      user_id: user.id,
    }

    let error
    if (initial?.id) {
      ;({ error } = await supabase.from('incomes').update(payload).eq('id', initial.id))
    } else {
      ;({ error } = await supabase.from('incomes').insert(payload))
    }

    if (error) {
      console.error('Error al guardar ingreso:', error)
      alert('Error al guardar el ingreso')
    } else {
      onSaved()
    }
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

          {/* Dropdown de categorías */}
          <select
            value={addingNew ? '__new' : form.category_id ?? ''}
            onChange={(e) => {
              if (e.target.value === '__new') {
                setAddingNew(true)
                setNewCategoryName('')
                setForm({ ...form, category_id: undefined })
              } else {
                setAddingNew(false)
                setForm({ ...form, category_id: Number(e.target.value) })
              }
            }}
            className="w-full border rounded px-3 py-2"
          >
            <option value="">– Sin categoría –</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="__new">+ Agregar nueva categoría</option>
          </select>

          {/* Input para nueva categoría */}
          {addingNew && (
            <input
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="Nombre de nueva categoría"
              className="w-full border rounded px-3 py-2"
              required
            />
          )}

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