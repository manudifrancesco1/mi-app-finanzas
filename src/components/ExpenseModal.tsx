import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'

export type ExpenseForm = {
  id?: number
  category_id: number
  new_category?: string
  subcategory_id?: number | null
  new_subcategory?: string
  amount: string
  date: string
  description: string
  tags?: string
  payment_type: 'credit' | 'debit' | 'transfer'
  installments?: string
  expense_mode: 'variable' | 'fixed'
}

interface Props {
  initial?: ExpenseForm
  onClose: () => void
  onSaved: () => void
  onDelete?: () => void
}

export default function ExpenseModal({ initial, onClose, onSaved, onDelete }: Props) {
  const isEditing = Boolean(initial?.id)

  const [form, setForm] = useState<ExpenseForm>(
    initial ?? {
      category_id: 0,
      new_category: '',
      subcategory_id: null,
      new_subcategory: '',
      amount: '',
      date: '',
      description: '',
      tags: '',
      payment_type: 'debit',
      installments: '',
      expense_mode: 'variable'
    }
  )

  // Handle input changes
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
  }

  // Submit (create or update)
  const handleSubmit = async () => {
    const {
      data: { session }
    } = await supabase.auth.getSession()
    if (!session) return

    const uid = session.user.id

    // 1) Create category if needed
    let categoryId = form.category_id
    if (form.new_category && form.new_category.trim()) {
      const { data: catData } = await supabase
        .from('categories')
        .insert({ name: form.new_category.trim(), user_id: uid })
        .select('id')
        .single()
      if (catData) categoryId = catData.id
    }

    // 2) Create subcategory if needed
    let subcategoryId = form.subcategory_id ?? null
    if (form.new_subcategory && form.new_subcategory.trim()) {
      const { data: subData } = await supabase
        .from('subcategories')
        .insert({ name: form.new_subcategory.trim(), category_id: categoryId })
        .select('id')
        .single()
      if (subData) subcategoryId = subData.id
    }

    if (isEditing && form.id) {
      // UPDATE existing
      await supabase
        .from('transactions')
        .update({
          amount: parseFloat(form.amount),
          date: form.date,
          description: form.description,
          category_id: categoryId,
          subcategory_id: subcategoryId
        })
        .eq('id', form.id)
    } else {
      // INSERT new
      await supabase.from('transactions').insert({
        user_id: uid,
        amount: parseFloat(form.amount),
        date: form.date,
        description: form.description,
        category_id: categoryId,
        subcategory_id: subcategoryId
      })
    }

    onSaved()
  }

  // Delete
  const handleDelete = async () => {
    if (!form.id) return
    await supabase.from('transactions').delete().eq('id', form.id)
    onDelete?.()
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white p-6 rounded shadow-lg w-full max-w-md">
        <h2 className="text-xl font-bold mb-4">
          {isEditing ? 'Editar Gasto' : 'Nuevo Gasto'}
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium">Fecha</label>
            <input
              type="date"
              name="date"
              value={form.date}
              onChange={handleChange}
              className="w-full border px-2 py-1 rounded"
            />
          </div>

          <div>
            <label className="block text-sm font-medium">Monto</label>
            <input
              type="number"
              name="amount"
              value={form.amount}
              onChange={handleChange}
              className="w-full border px-2 py-1 rounded"
            />
          </div>

          <div>
            <label className="block text-sm font-medium">Categoría</label>
            <input
              type="text"
              name="new_category"
              placeholder="Nueva o existente"
              value={form.new_category}
              onChange={handleChange}
              className="w-full border px-2 py-1 rounded"
            />
          </div>

          <div>
            <label className="block text-sm font-medium">Subcategoría</label>
            <input
              type="text"
              name="new_subcategory"
              placeholder="Nueva o existente"
              value={form.new_subcategory}
              onChange={handleChange}
              className="w-full border px-2 py-1 rounded"
            />
          </div>

          <div>
            <label className="block text-sm font-medium">Descripción</label>
            <input
              type="text"
              name="description"
              value={form.description}
              onChange={handleChange}
              className="w-full border px-2 py-1 rounded"
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end space-x-2">
          {isEditing && (
            <button
              onClick={handleDelete}
              className="px-4 py-2 bg-red-100 text-red-600 rounded"
            >
              Eliminar
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 rounded"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 bg-blue-600 text-white rounded"
          >
            {isEditing ? 'Guardar' : 'Crear'}
          </button>
        </div>
      </div>
    </div>
  )
}
