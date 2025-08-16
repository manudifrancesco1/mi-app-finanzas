import React, { useState, useEffect, useMemo, useRef } from 'react'

const normalizeName = (s: string) => s.trim().toLowerCase()
const uniqueByName = (arr: { id: number; name: string }[]) => {
  const seen = new Set<string>()
  const out: { id: number; name: string }[] = []
  for (const c of arr) {
    const key = normalizeName(c.name)
    if (!seen.has(key)) {
      seen.add(key)
      out.push(c)
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

import { supabase } from '../lib/supabaseClient'

export type ExpenseForm = {
  id?: number
  category_id: number | null
  subcategory_id?: number | null
  amount: string
  date: string
  description: string
  payment_type?: string
  // opcionales que podrían venir desde callers viejos; se ignoran si están
  new_category?: string
  new_subcategory?: string
}

interface Props {
  initial?: ExpenseForm
  onClose: () => void
  onSaved: () => void
  onDelete?: () => void
}

// Money helpers
const toNumeric = (v: string) => Number(String(v).replace(/[^0-9.,-]/g, '').replace(/\.(?=.*,)/g, '').replace(',', '.'))
const formatMoney = (v: string | number) => {
  const n = typeof v === 'number' ? v : toNumeric(v)
  if (!isFinite(n)) return ''
  return new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

const LAST_PAYMENT_KEY = 'mf_last_payment_type'
const LAST_CATEGORY_KEY = 'mf_last_category_id'

export default function ExpenseModal({ initial, onClose, onSaved, onDelete }: Props) {
  const [categories, setCategories] = useState<any[]>([])
  const [subcategories, setSubcategories] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [addingNew, setAddingNew] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [addingNewSub, setAddingNewSub] = useState(false)
  const [newSubName, setNewSubName] = useState('')

  // Read last preferences
  const lastPayment = useMemo(() => {
    try { return localStorage.getItem(LAST_PAYMENT_KEY) || 'debito' } catch { return 'debito' }
  }, [])
  const lastCategoryId = useMemo(() => {
    try { const v = localStorage.getItem(LAST_CATEGORY_KEY); return v ? Number(v) : null } catch { return null }
  }, [])

  const [form, setForm] = useState<ExpenseForm>({
    id: initial?.id,
    amount: initial?.amount ?? '',
    date: initial?.date ?? '',
    description: initial?.description ?? '',
    category_id: initial?.category_id ?? lastCategoryId ?? null,
    subcategory_id: initial?.subcategory_id ?? null,
    payment_type: initial?.payment_type ?? lastPayment,
    new_category: '',
    new_subcategory: ''
  })

  const isEditing = Boolean(form.id)
  const amountInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => { amountInputRef.current?.focus() }, [])

  useEffect(() => { loadCategories() }, [])

  async function loadCategories() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setCategories([]); return }
    const { data, error } = await supabase.from('categories').select('id, name').eq('user_id', session.user.id).order('name', { ascending: true })
    if (error) { console.error(error); setCategories([]) } else { setCategories(uniqueByName(data || [])) }
  }

  async function loadSubcategories(categoryId: number | null) {
    if (!categoryId) { setSubcategories([]); return }
    const { data, error } = await supabase.from('subcategories').select('id, name, category_id').eq('category_id', categoryId).order('name', { ascending: true })
    if (error) { console.error(error); setSubcategories([]) } else { setSubcategories(uniqueByName((data || []).map((s: any) => ({ id: s.id, name: s.name })))) }
  }

  useEffect(() => {
    loadSubcategories(form.category_id || null)
    setAddingNewSub(false)
    setNewSubName('')
    setForm(prev => ({ ...prev, subcategory_id: null }))
    // persist last category
    if (form.category_id) {
      try { localStorage.setItem(LAST_CATEGORY_KEY, String(form.category_id)) } catch {}
    }
  }, [form.category_id])

  // keyboard shortcuts for payment type
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'c') setForm(p => ({ ...p, payment_type: 'credito' }))
      if (e.key.toLowerCase() === 'd') setForm(p => ({ ...p, payment_type: 'debito' }))
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // persist payment type
  useEffect(() => {
    try { if (form.payment_type) localStorage.setItem(LAST_PAYMENT_KEY, form.payment_type) } catch {}
  }, [form.payment_type])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { alert('No estás autenticado'); setLoading(false); return }
    const user = session.user

    // ===== Categoría =====
    let categoryId = form.category_id
    if (addingNew && newCategoryName.trim()) {
      const newNameRaw = newCategoryName.trim()
      const newNameKey = normalizeName(newNameRaw)
      const { data: existingCats, error: findCatErr } = await supabase
        .from('categories').select('id, name').eq('user_id', user.id).ilike('name', newNameRaw)
      if (findCatErr) { console.error('Error buscando categoría existente:', findCatErr); alert('Error buscando categoría existente'); setLoading(false); return }
      const exact = (existingCats || []).find(c => normalizeName(c.name) === newNameKey)
      if (exact) categoryId = exact.id
      else {
        const { data: created, error: catErr } = await supabase.from('categories').insert({ name: newNameRaw, user_id: user.id }).select('id, name').single()
        if (catErr || !created) { console.error('Error al crear categoría:', catErr); alert('Error al crear categoría'); setLoading(false); return }
        categoryId = created.id
      }
      await loadCategories(); setAddingNew(false); setNewCategoryName('')
    }

    // ===== Subcategoría (opcional) =====
    let subcategoryId = form.subcategory_id ?? null
    if (addingNewSub && newSubName.trim() && categoryId) {
      const raw = newSubName.trim()
      const { data: existSubs, error: findSubErr } = await supabase.from('subcategories').select('id, name, category_id').eq('category_id', categoryId).ilike('name', raw)
      if (findSubErr) { console.error('Error buscando subcategoría existente:', findSubErr); alert('Error buscando subcategoría existente'); setLoading(false); return }
      const exactSub = (existSubs || []).find(s => normalizeName(s.name) === normalizeName(raw))
      if (exactSub) subcategoryId = exactSub.id
      else {
        const { data: createdSub, error: insSubErr } = await supabase.from('subcategories').insert({ name: raw, category_id: categoryId }).select('id, name').single()
        if (insSubErr || !createdSub) { console.error('Error al crear subcategoría:', insSubErr); alert('Error al crear subcategoría'); setLoading(false); return }
        subcategoryId = createdSub.id
      }
      await loadSubcategories(categoryId); setAddingNewSub(false); setNewSubName('')
    }

    // ===== Guardar transacción variable =====
    const payload = {
      user_id: user.id,
      amount: toNumeric(form.amount || '0'),
      date: form.date,
      description: form.description,
      category_id: categoryId,
      subcategory_id: subcategoryId,
      expense_mode: 'variable' as const,
      payment_type: form.payment_type || null
    }

    if (!categoryId) { alert('Seleccioná una categoría'); setLoading(false); return }

    if (form.id) {
      const { error } = await supabase.from('transactions').update(payload).eq('id', form.id)
      if (error) { console.error(error); alert('Error al actualizar gasto'); setLoading(false); return }
    } else {
      const { error } = await supabase.from('transactions').insert(payload)
      if (error) { console.error(error); alert('Error al crear gasto'); setLoading(false); return }
    }

    onSaved(); onClose(); setLoading(false)
  }

  async function handleDelete() {
    if (!form.id) return
    const { error } = await supabase.from('transactions').delete().eq('id', form.id)
    if (error) { console.error(error); alert('No se pudo eliminar el gasto'); return }
    onDelete?.()
  }

  // Filtered lists for simple search (works with select via datalist)
  const catNames = useMemo(() => uniqueByName(categories), [categories])
  const subNames = useMemo(() => uniqueByName(subcategories), [subcategories])

  return (
    <form onSubmit={handleSubmit} className="p-0 sm:p-4 w-full h-full">
      {/* Container for mobile full-screen: header + scroll + footer sticky */}
      <div className="flex flex-col h-full max-h-[90vh] sm:max-h-none">
        {/* Header */}
        <div className="px-4 pt-4 pb-2 sm:pt-0">
          <h2 className="text-lg font-semibold">{isEditing ? 'Editar gasto' : 'Nuevo gasto variable'}</h2>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto px-4 pb-24 sm:pb-4">
          {/* Tipo de pago */}
          <div className="mb-3">
            <label className="block mb-1">Tipo de pago</label>
            <div className="flex gap-2">
              <button
                type="button"
                aria-pressed={form.payment_type === 'credito'}
                className={`px-4 py-2 rounded-full border text-sm ${form.payment_type === 'credito' ? 'bg-violet-600 text-white border-violet-600' : 'bg-gray-100 text-gray-800 border-gray-300'}`}
                onClick={() => setForm(prev => ({ ...prev, payment_type: 'credito' }))}
              >
                Crédito
              </button>
              <button
                type="button"
                aria-pressed={form.payment_type === 'debito'}
                className={`px-4 py-2 rounded-full border text-sm ${form.payment_type === 'debito' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-gray-100 text-gray-800 border-gray-300'}`}
                onClick={() => setForm(prev => ({ ...prev, payment_type: 'debito' }))}
              >
                Débito
              </button>
            </div>
          </div>

          {/* Monto */}
          <div className="mb-3">
            <label className="block mb-1">Monto</label>
            <div className="flex items-center border rounded px-2">
              <span className="text-gray-500 mr-2">$</span>
              <input
                ref={amountInputRef}
                type="text"
                inputMode="decimal"
                value={form.amount}
                onChange={e => {
                  const raw = e.target.value
                  // allow digits, comma, dot
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

          {/* Categoría */}
          <div className="mb-3">
            <label className="block mb-1">Categoría</label>
            {!addingNew ? (
              <select
                value={form.category_id || ''}
                onChange={e => e.target.value === 'new' ? setAddingNew(true) : setForm({ ...form, category_id: e.target.value ? Number(e.target.value) : null })}
                className="w-full border rounded px-2 py-2"
              >
                <option value="">Buscar o seleccionar…</option>
                {catNames.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
                <option value="new">+ Nueva categoría</option>
              </select>
            ) : (
              <div>
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={e => setNewCategoryName(e.target.value)}
                  className="w-full border rounded px-2 py-2 mb-2"
                  placeholder="Nombre de la nueva categoría"
                />
                <button type="button" onClick={() => setAddingNew(false)} className="text-sm text-blue-600">Cancelar</button>
              </div>
            )}
          </div>

          {/* Subcategoría */}
          <div className="mb-3">
            <label className="block mb-1">Subcategoría (opcional)</label>
            {!addingNewSub ? (
              <div className="flex gap-2">
                <select
                  value={form.subcategory_id || ''}
                  onChange={e => { const v = e.target.value; setForm(prev => ({ ...prev, subcategory_id: v ? Number(v) : null })) }}
                  className="w-full border rounded px-2 py-2"
                  disabled={!form.category_id}
                >
                  <option value="">Sin subcategoría</option>
                  {subNames.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <button type="button" onClick={() => setAddingNewSub(true)} className="px-3 py-2 text-sm border rounded disabled:opacity-50" disabled={!form.category_id}>+ Nueva</button>
              </div>
            ) : (
              <div>
                <input
                  type="text"
                  value={newSubName}
                  onChange={e => setNewSubName(e.target.value)}
                  className="w-full border rounded px-2 py-2 mb-2"
                  placeholder="Nombre de la nueva subcategoría"
                />
                <button type="button" onClick={() => setAddingNewSub(false)} className="text-sm text-blue-600">Cancelar</button>
              </div>
            )}
          </div>

          {/* Fecha */}
          <div className="mb-3">
            <label className="block mb-1">Fecha</label>
            <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required className="w-full border rounded px-2 py-2" />
          </div>

          {/* Descripción */}
          <div className="mb-3">
            <label className="block mb-1">Descripción (opcional)</label>
            <input type="text" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="w-full border rounded px-2 py-2" />
          </div>
        </div>

        {/* Footer sticky */}
        <div className="px-4 py-3 border-t bg-white sticky bottom-0 flex gap-2 justify-end">
          {isEditing && (
            <button type="button" onClick={handleDelete} className="px-3 py-2 border rounded text-red-600">Eliminar</button>
          )}
          <button type="button" onClick={onClose} className="px-4 py-2 border rounded">Cancelar</button>
          <button type="submit" disabled={loading || !form.amount || !form.date || !form.category_id} className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50">Guardar</button>
        </div>
      </div>
    </form>
  )
}
