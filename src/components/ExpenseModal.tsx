// src/components/ExpenseModal.tsx
import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { PlusIcon } from '@heroicons/react/24/outline'

type Category = { id: number; name: string; is_fixed?: boolean }
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
  onClose: () => void
  onSaved: () => void
  initial?: ExpenseForm
}

export default function ExpenseModal({ onClose, onSaved, initial }: Props) {
  const isEditing = Boolean(initial?.id)
  const [mode, setMode] = useState<'variable' | 'fixed'>(initial?.expense_mode || 'variable')
  const [error, setError] = useState<string | null>(null)

  // --- State for VARIABLE tab ---
  const [categories, setCategories] = useState<Category[]>([])
  const [topCategories, setTopCategories] = useState<Category[]>([])
  const [subcategories, setSubcategories] = useState<Category[]>([])
  const [showNewCategory, setShowNewCategory] = useState(false)
  const [showNewSubcategory, setShowNewSubcategory] = useState(false)
  const [customInstall, setCustomInstall] = useState(false)
  const [form, setForm] = useState<ExpenseForm>({
    id: initial?.id,
    category_id: initial?.category_id || 0,
    new_category: '',
    subcategory_id: initial?.subcategory_id ?? null,
    new_subcategory: '',
    amount: initial?.amount || '',
    date: initial?.date || new Date().toISOString().slice(0, 10),
    description: initial?.description || '',
    tags: initial?.tags || '',
    payment_type: initial?.payment_type || 'credit',
    installments: initial?.installments || '1',
    expense_mode: initial?.expense_mode || 'variable'
  })

  // Load categories
  useEffect(() => {
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: cats } = await supabase
        .from('categories')
        .select('id,name,type,is_fixed')
        .eq('user_id', user.id)
        .eq('type', 'expense')
        .order('name')
      const arr = cats || []
      setCategories(arr)
      setTopCategories(arr.filter(c => !c.is_fixed).slice(0, 5))
    })()
  }, [])

  // Load subcategories when category changes
  useEffect(() => {
    if (!form.category_id) {
      setSubcategories([])
      return
    }
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: subs } = await supabase
        .from('subcategories')
        .select('id,name')
        .eq('user_id', user.id)
        .eq('category_id', form.category_id)
        .order('name')
      setSubcategories(subs || [])
    })()
  }, [form.category_id])

  const handleChangeVar = (e: React.ChangeEvent<any>) => {
    const { name, value, type, checked } = e.target
    setForm(f => ({ ...f, [name]: type === 'checkbox' ? checked : value }))
  }

  const handleSubmitVariable = async () => {
    setError(null)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Debes iniciar sesión'); return }

    let cat_id = form.category_id
    if (showNewCategory && form.new_category?.trim()) {
      const { data, error: catErr } = await supabase
        .from('categories')
        .insert({ user_id: user.id, name: form.new_category.trim(), type: 'expense', is_fixed: false })
        .select('id')
        .limit(1)
      if (catErr || !data || data.length === 0) {
        setError(catErr?.message || 'Error al crear categoría')
        return
      }
      cat_id = data[0].id
    }

    let sub_id = form.subcategory_id ?? null
    if (showNewSubcategory && form.new_subcategory?.trim()) {
      const { data: subData, error: subErr } = await supabase
        .from('subcategories')
        .insert({ user_id: user.id, category_id: cat_id, name: form.new_subcategory.trim() })
        .select('id')
        .limit(1)
      if (subErr || !subData || subData.length === 0) {
        setError(subErr?.message || 'Error al crear subcategoría')
        return
      }
      sub_id = subData[0].id
    }

    const payload: any = {
      user_id: user.id,
      category_id: cat_id,
      subcategory_id: sub_id,
      amount: parseFloat(form.amount),
      date: form.date,
      description: form.description || null,
      tags: form.tags?.split(',').map(t => t.trim()) || [],
      payment_type: form.payment_type,
      installments: form.payment_type === 'credit' ? parseInt(form.installments!, 10) : null,
      expense_mode: 'variable'
    }

    if (isEditing) {
      const { error: updErr } = await supabase.from('transactions')
        .update(payload)
        .eq('id', form.id)
      if (updErr) { setError(updErr.message); return }
    } else {
      const { error: insErr } = await supabase.from('transactions')
        .insert(payload)
      if (insErr) { setError(insErr.message); return }
    }

    onSaved()
  }

  // --- State for FIXED tab ---
  const [fixedCats, setFixedCats] = useState<Category[]>([])
  const [fixedAmounts, setFixedAmounts] = useState<Record<number, string>>({})
  const [paid, setPaid] = useState<Record<number, boolean>>({})
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`
  })

  // Load fixed cats and payments for month
  useEffect(() => {
    ;(async () => {
      setError(null)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const SEED = ['Alquiler','Expensas','Luz','Gas','OSDE','Tarjeta Visa']
      let { data: cats, error: catErr } = await supabase
        .from('categories').select('id,name')
        .eq('user_id', user.id).eq('is_fixed', true)
      if (catErr) { setError(catErr.message); return }
      cats = cats || []
      const exist = cats.map(c => c.name)
      const missing = SEED.filter(n => !exist.includes(n))
      if (missing.length) {
        await supabase.from('categories').insert(
          missing.map(name => ({ user_id: user.id, name, type: 'expense', is_fixed: true }))
        )
        const { data: allF } = await supabase
          .from('categories').select('id,name')
          .eq('user_id', user.id).eq('is_fixed', true)
        cats = allF || []
      }
      setFixedCats(cats)

      const ai: Record<number,string> = {}
      const pi: Record<number,boolean> = {}
      cats.forEach(c => { ai[c.id] = ''; pi[c.id] = false })

      const [year, month] = selectedMonth.split('-')
      const start = `${year}-${month}-01`
      const lastDay = new Date(+year, +month, 0).getDate()
      const end = `${year}-${month}-${String(lastDay).padStart(2,'0')}`

      const { data: txs, error: txErr } = await supabase
        .from('transactions')
        .select('category_id,amount')
        .eq('user_id', user.id)
        .eq('expense_mode', 'fixed')
        .gte('date', start)
        .lte('date', end)
      if (txErr) { setError(txErr.message); return }
      txs?.forEach(tx => {
        ai[tx.category_id] = tx.amount.toString()
        pi[tx.category_id] = true
      })

      setFixedAmounts(ai)
      setPaid(pi)
    })()
  }, [selectedMonth])

  const handleFixedAmount = (catId: number, val: string) => {
    setFixedAmounts(fa => ({ ...fa, [catId]: val }))
  }

  const handleSaveFixed = async (catId: number) => {
    setError(null)
    const amt = parseFloat(fixedAmounts[catId])
    if (isNaN(amt) || amt <= 0) { setError('Ingresa monto válido'); return }
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Debes iniciar sesión'); return }
    const date = `${selectedMonth}-01`
    const { error: insErr } = await supabase.from('transactions')
      .insert({
        user_id: user.id,
        category_id: catId,
        subcategory_id: null,
        amount: amt,
        date,
        description: null,
        payment_type: 'transfer',
        installments: null,
        expense_mode: 'fixed'
      })
    if (insErr) { setError(insErr.message); return }
    setPaid(p => ({ ...p, [catId]: true }))
  }

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl p-6 w-full max-w-md"
        onClick={e => e.stopPropagation()}
      >
        {/* Tabs */}
        <div className="flex mb-4 rounded overflow-hidden">
          <button
            onClick={() => setMode('variable')}
            className={`flex-1 py-2 text-center transition-colors ${
              mode === 'variable'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Variable
          </button>
          <button
            onClick={() => setMode('fixed')}
            className={`flex-1 py-2 text-center transition-colors ${
              mode === 'fixed'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Fijo
          </button>
        </div>

        {mode === 'fixed' ? (
          <>
            <h2 className="text-lg font-medium mb-3">Pagos fijos</h2>
            {error && <p className="text-red-500 mb-2">{error}</p>}

            {/* Month selector */}
            <div className="mb-4">
              <label className="block mb-1">Mes:</label>
              <input
                type="month"
                value={selectedMonth}
                onChange={e => setSelectedMonth(e.target.value)}
                className="w-full border p-2 rounded"
              />
            </div>

            <ul className="space-y-4 mb-4">
              {fixedCats.map(cat => (
                <li
                  key={cat.id}
                  className={`flex items-center gap-3 p-2 rounded ${
                    paid[cat.id] ? 'bg-green-100' : ''
                  }`}
                >
                  <span className="w-1/2">{cat.name}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={fixedAmounts[cat.id]}
                    onChange={e => handleFixedAmount(cat.id, e.target.value)}
                    disabled={paid[cat.id]}
                    className="flex-1 border p-2 rounded text-right"
                  />
                  <button
                    onClick={() => handleSaveFixed(cat.id)}
                    disabled={paid[cat.id]}
                    className={`px-3 py-1 rounded ${
                      paid[cat.id]
                        ? 'bg-green-500 text-white'
                        : 'bg-blue-500 text-white hover:bg-blue-600'
                    }`}
                  >
                    {paid[cat.id] ? '✓' : 'Agregar'}
                  </button>
                </li>
              ))}
            </ul>

            <div className="flex justify-end">
              <button onClick={onClose} className="px-4 py-2 bg-gray-200 rounded">
                Cerrar
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-medium mb-4">
              {isEditing ? 'Editar gasto' : 'Nuevo gasto'}
            </h2>
            {error && <p className="text-red-500 mb-2">{error}</p>}

            {/* Quick categories */}
            <div className="flex overflow-x-auto gap-2 mb-3">
              {topCategories.map(c => (
                <button
                  key={c.id}
                  onClick={() => {
                    setForm(f => ({ ...f, category_id: c.id }))
                    setShowNewCategory(false)
                  }}
                  className={`px-3 py-1 rounded-full whitespace-nowrap ${
                    form.category_id === c.id
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-200 text-gray-700'
                  }`}
                >
                  {c.name}
                </button>
              ))}
              <button
                onClick={() => setShowNewCategory(v => !v)}
                className="px-3 py-1 rounded-full bg-green-500 text-white"
              >
                <PlusIcon className="h-5 w-5" />
              </button>
            </div>
            {showNewCategory ? (
              <input
                name="new_category"
                type="text"
                placeholder="Nombre categoría"
                value={form.new_category}
                onChange={handleChangeVar}
                className="w-full border p-2 rounded mb-3"
              />
            ) : (
              <select
                name="category_id"
                value={form.category_id}
                onChange={handleChangeVar}
                className="w-full border p-2 rounded mb-3"
              >
                <option value={0}>-- Selecciona categoría --</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}

            {/* Subcategory selector */}
            <div className="relative mb-3">
              <button
                onClick={() => setShowNewSubcategory(v => !v)}
                className="absolute top-0 right-0 bg-yellow-500 text-white rounded-full p-1 z-10"
                title="Nueva subcategoría"
              >
                <PlusIcon className="h-4 w-4" />
              </button>
              {showNewSubcategory ? (
                <input
                  name="new_subcategory"
                  type="text"
                  placeholder="Nombre subcategoría"
                  value={form.new_subcategory}
                  onChange={handleChangeVar}
                  className="w-full border p-2 rounded"
                />
              ) : subcategories.length > 0 ? (
                <select
                  name="subcategory_id"
                  value={form.subcategory_id || 0}
                  onChange={handleChangeVar}
                  className="w-full border p-2 rounded"
                >
                  <option value={0}>-- Selecciona subcategoría --</option>
                  {subcategories.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-gray-500">Selecciona categoría primero</p>
              )}
            </div>

            {/* Payment type */}
            <div className="flex gap-2 mb-3">
              {(['credit', 'debit', 'transfer'] as const).map(type => (
                <button
                  key={type}
                  onClick={() => setForm(f => ({ ...f, payment_type: type }))}
                  className={`flex-1 py-2 rounded ${
                    form.payment_type === type
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-200 text-gray-700'
                  }`}
                >
                  {type === 'credit'
                    ? 'Crédito'
                    : type === 'debit'
                    ? 'Débito'
                    : 'Transferencia'}
                </button>
              ))}
            </div>

            {/* Installments */}
            {form.payment_type === 'credit' && (
              <>
                <div className="flex gap-2 mb-3">
                  {[1, 3, 6, 12].map(n => (
                    <button
                      key={n}
                      onClick={() => setForm(f => ({ ...f, installments: String(n) }))}
                      className={`px-3 py-1 rounded-full ${
                        form.installments === String(n)
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-200 text-gray-700'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                  <button
                    onClick={() => setCustomInstall(true)}
                    className="px-3 py-1 rounded-full bg-gray-200 text-gray-700"
                  >
                    +
                  </button>
                </div>
                {(customInstall || !['1','3','6','12'].includes(form.installments!)) && (
                  <input
                    name="installments"
                    type="number"
                    min="1"
                    placeholder="Cuotas"
                    value={form.installments}
                    onChange={handleChangeVar}
                    className="w-full border p-2 rounded mb-3"
                  />
                )}
              </>
            )} 

            {/* Amount, Date, Description, Tags */}
            <input
              name="amount"
              type="number"
              placeholder="Monto"
              value={form.amount}
              onChange={handleChangeVar}
              className="w-full border p-2 rounded mb-3"
            />
            <input
              name="date"
              type="date"
              value={form.date}
              onChange={handleChangeVar}
              className="w-full border p-2 rounded mb-3"
            />
            <input
              name="description"
              type="text"
              placeholder="Descripción (opcional)"
              value={form.description}
              onChange={handleChangeVar}
              className="w-full border p-2 rounded mb-3"
            />
            <input
              name="tags"
              type="text"
              placeholder="Tags (separa con comas)"
              value={form.tags}
              onChange={handleChangeVar}
              className="w-full border p-2 rounded mb-4"
            />

            <div className="flex justify-end space-x-2">
              <button onClick={onClose} className="px-4 py-2 bg-gray-200 rounded">
                Cancelar
              </button>
              <button
                onClick={handleSubmitVariable}
                className="px-4 py-2 bg-blue-500 text-white rounded"
              >
                {isEditing ? 'Guardar cambios' : 'Guardar'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
