const ALLOWED_CATEGORY_NAMES = [
  'Alimentación',
  'Comidas afuera',
  'Transporte',
  'Salud',
  'Educación',
  'Hogar',
  'Ropa',
  'Ocio',
  'Viajes',
  'Regalos',
  'Trabajo',
  'Varios'
]
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

import { supabase } from '@/lib/supabaseClient'

export type ExpenseForm = {
  id?: number
  category_id: number | null
  amount: string
  date: string
  description: string
  payment_type?: string
  // opcionales que podrían venir desde callers viejos; se ignoran si están
  new_category?: string
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
  const [loading, setLoading] = useState(false)
  const [addingNew, setAddingNew] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')

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
    payment_type: initial?.payment_type ?? lastPayment,
    new_category: ''
  })

  const isEditing = Boolean(form.id)
  const amountInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => { amountInputRef.current?.focus() }, [])

  useEffect(() => {
    if (!form.date) {
      const d = new Date()
      const yyyy = d.getFullYear()
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      setForm(prev => ({ ...prev, date: `${yyyy}-${mm}-${dd}` }))
    }
  }, [])

  useEffect(() => { loadCategories() }, [])

  async function loadCategories() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setCategories([]); return }
    const { data, error } = await supabase
      .from('categories')
      .select('id, name, is_fixed, type')
      .eq('user_id', session.user.id)
      .order('name', { ascending: true })
    if (error) {
      console.error(error)
      setCategories([])
    } else {
      const all = uniqueByName((data || []).map((c: any) => ({ id: c.id, name: c.name })))
      const filtered = all.filter(c => ALLOWED_CATEGORY_NAMES.includes(c.name) || c.id === (form.category_id ?? -1))
      setCategories(filtered.length > 0 ? filtered : all)
    }
  }

  useEffect(() => {
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

    // simple client-side validation
    if (!form.amount) { amountInputRef.current?.focus(); setLoading(false); return }
    if (!form.date) { setLoading(false); alert('Elegí una fecha'); return }
    if (!form.category_id && !addingNew) { setLoading(false); alert('Seleccioná una categoría'); return }

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
        const { data: created, error: catErr } = await supabase
          .from('categories')
          .insert({ name: newNameRaw, user_id: user.id, is_fixed: false, type: 'expense' })
          .select('id, name')
          .single()
        if (catErr || !created) { console.error('Error al crear categoría:', catErr); alert('Error al crear categoría'); setLoading(false); return }
        categoryId = created.id
      }
      await loadCategories(); setAddingNew(false); setNewCategoryName('')
    }

    // ===== Guardar transacción variable =====
    const payload = {
      user_id: user.id,
      amount: toNumeric(form.amount || '0'),
      date: form.date,
      description: form.description,
      category_id: categoryId,
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

  return (
    <form onSubmit={handleSubmit} className="p-0 sm:p-4 w-full h-full">
      {/* Container for mobile full-screen: header + scroll + footer sticky */}
      <div className="flex flex-col h-full max-h-[90vh] sm:max-h-none">
        {/* Header */}
        <div className="px-3 pt-2 pb-1 sm:pt-0 bg-white/60 backdrop-blur-xl flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">
            {isEditing ? 'Editar gasto' : 'Nuevo gasto'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="p-2 -mr-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto px-3 pb-20 sm:pb-4">
          {/* Tipo de pago */}
          <div className="mb-3">
            <label className="block mb-1 text-[13px] font-medium text-gray-700">Tipo de pago</label>
            <div className="inline-flex rounded-full bg-gray-100 p-1 shadow-inner gap-1">
              <button
                type="button"
                aria-pressed={form.payment_type === 'credito'}
                className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all ${form.payment_type === 'credito' ? 'bg-white shadow-sm ring-1 ring-black/5 text-gray-900' : 'bg-transparent text-gray-600 hover:text-gray-900'}`}
                onClick={() => setForm(prev => ({ ...prev, payment_type: 'credito' }))}
              >
                Crédito
              </button>
              <button
                type="button"
                aria-pressed={form.payment_type === 'debito'}
                className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all ${form.payment_type === 'debito' ? 'bg-white shadow-sm ring-1 ring-black/5 text-gray-900' : 'bg-transparent text-gray-600 hover:text-gray-900'}`}
                onClick={() => setForm(prev => ({ ...prev, payment_type: 'debito' }))}
              >
                Débito
              </button>
            </div>
          </div>

          {/* Monto */}
          <div className="mb-3">
            <div className="flex items-center border border-gray-200 rounded-2xl px-2.5 bg-white shadow-inner focus-within:ring-2 focus-within:ring-black/10">
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
                className="w-full py-2 outline-none text-base bg-transparent placeholder:text-gray-400 tabular-nums"
                required
              />
            </div>
          </div>

          {/* Categoría */}
          <div className="mb-3">
            <label className="block mb-1 text-[13px] font-medium text-gray-700">Categoría</label>
            {!addingNew ? (
              <select
                value={form.category_id || ''}
                onChange={e => e.target.value === 'new' ? setAddingNew(true) : setForm({ ...form, category_id: e.target.value ? Number(e.target.value) : null })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 bg-white shadow-sm focus:ring-2 focus:ring-black/10 focus:border-gray-300"
              >
                <option value="">Elegí una categoría…</option>
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
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 mb-2 bg-white shadow-sm focus:ring-2 focus:ring-black/10 focus:border-gray-300"
                  placeholder="Nombre de la nueva categoría"
                />
                <button type="button" onClick={() => setAddingNew(false)} className="text-sm text-blue-600">Cancelar</button>
              </div>
            )}
          </div>


          {/* Fecha */}
          <div className="mb-3">
            <label className="block mb-1 text-[13px] font-medium text-gray-700">Fecha</label>
            <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required className="w-full border border-gray-200 rounded-xl px-3 py-2 bg-white shadow-sm focus:ring-2 focus:ring-black/10 focus:border-gray-300" />
          </div>

          {/* Descripción */}
          <div className="mb-3">
            <label className="block mb-1 text-[13px] font-medium text-gray-700">Descripción (opcional)</label>
            <input type="text" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 bg-white shadow-sm focus:ring-2 focus:ring-black/10 focus:border-gray-300" />
          </div>
        </div>

        {/* Footer sticky */}
        <div className="px-3 py-2 border-t border-gray-100 bg-white/60 backdrop-blur-xl sticky bottom-0 flex gap-2 justify-end">
          {isEditing && (
            <button type="button" onClick={handleDelete} className="px-3 py-1.5 rounded-xl bg-red-50 text-red-600 hover:bg-red-100">Eliminar</button>
          )}
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 shadow-sm">Cancelar</button>
          <button type="submit" disabled={loading || !form.amount || !form.date || !form.category_id} className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-600 text-white shadow-md disabled:opacity-50">
            {loading ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </form>
  )
}
