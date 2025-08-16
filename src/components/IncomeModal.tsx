// src/components/IncomeModal.tsx
import { supabase } from '../lib/supabaseClient'

const normalizeName = (s: string) => s.trim().toLowerCase()
const uniqueByName = (arr: {id:number; name:string}[]) => {
  const seen = new Set<string>()
  const out: {id:number; name:string}[] = []
  for (const c of arr) {
    const key = normalizeName(c.name)
    if (!seen.has(key)) {
      seen.add(key)
      out.push(c)
    }
  }
  return out.sort((a,b) => a.name.localeCompare(b.name, 'es'))
}

const toNumeric = (v: string) => Number(String(v).replace(/[^0-9.,-]/g, '').replace(/\.(?=.*,)/g, '').replace(',', '.'))
const formatMoney = (v: string | number) => {
  const n = typeof v === 'number' ? v : toNumeric(v)
  if (!isFinite(n)) return ''
  return new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}
const LAST_CATEGORY_KEY = 'mf_income_last_category_id'

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
  const [form, setForm] = useState<IncomeForm>(() => {
    if (initial) return initial
    let lastCat: number | undefined
    try {
      const raw = localStorage.getItem(LAST_CATEGORY_KEY)
      if (raw) lastCat = Number(raw)
    } catch {}
    return { amount: '', date: '', description: '', category_id: lastCat }
  })
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
    else setCategories(uniqueByName(data || []))
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

    let categoryId = form.category_id
    if (addingNew && newCategoryName.trim()) {
      const newNameRaw = newCategoryName.trim()
      const newNameKey = normalizeName(newNameRaw)

      // 1) Buscar si ya existe una categoría con el mismo nombre (case-insensitive) para este usuario
      const { data: existingCats, error: findCatErr } = await supabase
        .from('categories')
        .select('id, name')
        .eq('user_id', user.id)
        .ilike('name', newNameRaw) // case-insensitive contains; si querés exacto: .filter('name','ilike', newNameRaw)

      if (findCatErr) {
        console.error('Error buscando categoría existente:', findCatErr)
        return alert('Error buscando categoría existente')
      }

      const exact = (existingCats || []).find(c => normalizeName(c.name) === newNameKey)
      if (exact) {
        categoryId = exact.id
      } else {
        // 2) Crear y devolver id en la misma operación
        const { data: created, error: catErr } = await supabase
          .from('categories')
          .insert({ name: newNameRaw, user_id: user.id })
          .select('id, name')
          .single()

        if (catErr || !created) {
          console.error('Error al crear categoría:', catErr)
          return alert('Error al crear categoría')
        }
        categoryId = created.id
      }

      // Refrescar y deduplicar lista para el selector
      await loadCategories()
      setAddingNew(false)
      setNewCategoryName('')
    }

    const payload = {
      amount: toNumeric(form.amount),
      date: form.date,
      description: form.description,
      category_id: categoryId,
      user_id: user.id,
    }

    if (categoryId) {
      setForm(prev => ({ ...prev, category_id: categoryId! }))
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
      <div className="bg-white w-full max-w-md max-h-[90vh] rounded-lg overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-4 pt-4 pb-2 border-b">
          <h2 className="text-lg font-semibold">{initial?.id ? 'Editar ingreso' : 'Nuevo ingreso'}</h2>
        </div>

        {/* Content (scrollable) */}
        <div className="flex-1 overflow-auto px-4 py-3">
          <form id="income-form" onSubmit={handleSubmit} className="space-y-4">
            {/* Monto */}
            <div>
              <label className="block mb-1">Monto</label>
              <div className="flex items-center border rounded px-2">
                <span className="text-gray-500 mr-2">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.amount}
                  onChange={(e) => {
                    const raw = e.target.value
                    const clean = raw.replace(/[^0-9.,-]/g, '')
                    setForm({ ...form, amount: clean })
                  }}
                  onBlur={() => setForm(prev => ({ ...prev, amount: formatMoney(prev.amount) }))}
                  placeholder="0,00"
                  className="w-full py-2 outline-none"
                  required
                />
              </div>
            </div>

            {/* Fecha */}
            <div>
              <label className="block mb-1">Fecha</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full border rounded px-3 py-2"
                required
              />
            </div>

            {/* Categoría */}
            <div>
              <label className="block mb-1">Categoría</label>
              <select
                value={addingNew ? '__new' : form.category_id ?? ''}
                onChange={(e) => {
                  if (e.target.value === '__new') {
                    setAddingNew(true)
                    setNewCategoryName('')
                    setForm({ ...form, category_id: undefined })
                  } else {
                    const id = Number(e.target.value)
                    setAddingNew(false)
                    setForm({ ...form, category_id: id })
                    try { localStorage.setItem(LAST_CATEGORY_KEY, String(id)) } catch {}
                  }
                }}
                className="w-full border rounded px-3 py-2"
              >
                <option value="">– Sin categoría –</option>
                {uniqueByName(categories).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
                <option value="__new">+ Agregar nueva categoría</option>
              </select>
            </div>

            {/* Nueva categoría */}
            {addingNew && (
              <div>
                <label className="block mb-1">Nueva categoría</label>
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="Nombre de nueva categoría"
                  className="w-full border rounded px-3 py-2"
                  required
                />
              </div>
            )}

            {/* Descripción */}
            <div>
              <label className="block mb-1">Descripción (opcional)</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Descripción"
                className="w-full border rounded px-3 py-2"
              />
            </div>
          </form>
        </div>

        {/* Footer sticky */}
        <div className="px-4 py-3 border-t bg-white flex gap-2 justify-end">
          {initial?.id && (
            <button type="button" onClick={handleDelete} className="px-3 py-2 border rounded text-red-600">Eliminar</button>
          )}
          <button type="button" onClick={onClose} className="px-4 py-2 border rounded">Cancelar</button>
          <button form="income-form" type="submit" className="px-4 py-2 bg-green-600 text-white rounded">Guardar</button>
        </div>
      </div>
    </div>
  )
}
export default IncomeModal