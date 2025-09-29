import { NextPage } from 'next'
import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import ExpenseModal, { ExpenseForm } from '../src/components/ExpenseModal'

type Tx = {
  id: number
  amount: number
  date: string
  description: string | null
  category_id: number
  expense_mode: 'variable' | 'fixed'
  payment_type?: 'credito' | 'debito' | null
  category: { name: string }
}

const Expenses: NextPage = () => {
  const [txs, setTxs] = useState<Tx[]>([])
  const [error, setError] = useState<string | null>(null)
  const [modeTab, setModeTab] = useState<'variable' | 'fixed'>('variable')
  const [showVarModal, setShowVarModal] = useState(false)
  const [selectedVar, setSelectedVar] = useState<ExpenseForm | null>(null)
  const [filterText, setFilterText] = useState('')
  const [payInputs, setPayInputs] = useState<Record<string, string>>({})
  const [extraMonths, setExtraMonths] = useState<string[]>([])
  const [editingRows, setEditingRows] = useState<Record<string, boolean>>({})

  const fixedCategories = [
    'Alquiler',
    'Expensas',
    'Gas',
    'Luz',
    'Telefono + Internet',
    'OSDE',
    'Gimnasio',
    'Tarjeta Visa',
    'Tarjeta Master'
  ]

  const ensureFixedCategoryId = async (name: string): Promise<number | null> => {
    const { data: sessionData } = await supabase.auth.getSession()
    const uid = sessionData.session?.user.id
    if (!uid) return null

    // Try to find existing category for this user
    const { data: found, error: findErr } = await supabase
      .from('categories')
      .select('id')
      .eq('user_id', uid)
      .eq('name', name)
      .maybeSingle()

    if (!findErr && found?.id) return found.id

    // Create if not exists
    const { data: created, error: insErr } = await supabase
      .from('categories')
      .insert({ name, user_id: uid, is_fixed: true })
      .select('id')
      .single()

    if (insErr) {
      console.error(insErr)
      return null
    }
    return created?.id ?? null
  }

  const payFixed = async (groupKey: string, categoryName: string, amountStr: string, existingTx?: Tx) => {
    const amount = parseFloat(amountStr.replace(',', '.'))
    if (!amount || isNaN(amount) || amount <= 0) return

    const {
      data: { session }
    } = await supabase.auth.getSession()
    if (!session) return

    const category_id = await ensureFixedCategoryId(categoryName)
    if (!category_id) return

    const date = `${groupKey}-01`
    const payload = {
      user_id: session.user.id,
      amount,
      date,
      description: existingTx?.description ?? '',
      category_id,
      expense_mode: 'fixed' as const
    }

    if (existingTx?.id) {
      const { error } = await supabase.from('transactions').update(payload).eq('id', existingTx.id)
      if (error) {
        console.error(error)
        return
      }
    } else {
      const { error } = await supabase.from('transactions').insert(payload)
      if (error) {
        console.error(error)
        return
      }
    }

    // Clear input and refresh
    const key = `${groupKey}__${categoryName}`
    setPayInputs(prev => ({ ...prev, [key]: '' }))
    setEditingRows(prev => ({ ...prev, [key]: false }))
    await loadTxs()
  }

  const loadTxs = async () => {
    setError(null)
    const {
      data: { session },
      error: sessionError
    } = await supabase.auth.getSession()
    if (sessionError) {
      console.error(sessionError)
      setError(sessionError.message)
      return
    }
    if (!session) return

    const uid = session.user.id
    const { data, error } = await supabase
      .from('transactions')
      .select(`
        id,
        amount,
        date,
        description,
        category_id,
        expense_mode,
        payment_type,
        category:category_id(name)
      `)
      .eq('user_id', uid)
      .order('date', { ascending: false })

    if (error) {
      console.error(error)
      setError(error.message)
    } else if (data) {
      const mapped: Tx[] = data.map(item => {
        const catField = (item as any).category
        const categoryName = Array.isArray(catField)
          ? catField[0]?.name ?? ''
          : catField?.name ?? ''
        return {
          id: item.id,
          amount: item.amount,
          date: item.date,
          description: item.description,
          category_id: item.category_id,
          expense_mode: (item as any).expense_mode ?? 'variable',
          payment_type: (item as any).payment_type ?? null,
          category: { name: categoryName }
        }
      })
      setTxs(mapped)
    }
  }

  useEffect(() => {
    loadTxs()
  }, [])

  const filteredTxs = txs
    .filter(tx => tx.expense_mode === modeTab)
    .filter(tx => {
      const texto = filterText.toLowerCase()
      const fields = [
        tx.date,
        tx.category.name,
        tx.description ?? ''
      ]
        .join(' ')
        .toLowerCase()
      return fields.includes(texto)
    })

  // === Agrupación por Mes ===
type MonthGroup = { key: string; label: string; items: Tx[] }

  const money = (n: number) =>
    new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

  const parseYearMonth = (iso: string) => {
    // Extrae YYYY y MM directamente del string para evitar desbordes por zona horaria
    const m = iso.match(/^(\d{4})-(\d{2})/)
    if (m) {
      return { y: parseInt(m[1], 10), m: parseInt(m[2], 10) }
    }
    // Fallback defensivo si viniera un formato raro
    const d = new Date(iso)
    return { y: d.getFullYear(), m: d.getMonth() + 1 }
  }

  const MONTHS_ES_SHORT = [
    'enero','febrero','marzo','abril','mayo','junio',
    'julio','agosto','septiembre','octubre','noviembre','diciembre'
  ]

  const monthKey = (iso: string) => {
    const { y, m } = parseYearMonth(iso)
    return `${y}-${String(m).padStart(2, '0')}`
  }

  const monthLabel = (iso: string) => {
    const { y, m } = parseYearMonth(iso)
    const name = MONTHS_ES_SHORT[m - 1] || ''
    const cap = name.charAt(0).toUpperCase() + name.slice(1)
    return `${cap} ${y}`
  }

  const labelFromKey = (key: string) => monthLabel(`${key}-15`)

  const nextMonthKey = (key: string) => {
    const [yStr, mStr] = key.split('-')
    let y = parseInt(yStr, 10)
    let m = parseInt(mStr, 10)
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
    return `${y}-${String(m).padStart(2, '0')}`
  }

  const groupedByMonth: MonthGroup[] = (() => {
    const map = new Map<string, MonthGroup>()
    for (const tx of filteredTxs) {
      const key = monthKey(tx.date)
      if (!map.has(key)) {
        map.set(key, { key, label: monthLabel(tx.date), items: [] })
      }
      map.get(key)!.items.push(tx)
    }
    // ordenar items por fecha desc y grupos por key desc
    const groups = Array.from(map.values())
    groups.forEach(g => g.items.sort((a, b) => (a.date < b.date ? 1 : -1)))
    groups.sort((a, b) => (a.key < b.key ? 1 : -1))
    return groups
  })()

  // Totales por mes (suma de amounts en cada grupo)
  const monthTotals: Record<string, number> = (() => {
    const acc: Record<string, number> = {}
    for (const g of groupedByMonth) {
      if (modeTab === 'fixed') {
        acc[g.key] = g.items
          .filter(tx => fixedCategories.includes(tx.category.name))
          .reduce((sum, tx) => sum + (tx.amount || 0), 0)
      } else {
        acc[g.key] = g.items.reduce((sum, tx) => sum + (tx.amount || 0), 0)
      }
    }
    return acc
  })()

  // Unir meses reales (con movimientos) con meses extra agregados manualmente
  const allGroups: MonthGroup[] = (() => {
    const map = new Map<string, MonthGroup>()
    for (const g of groupedByMonth) map.set(g.key, g)
    for (const k of extraMonths) {
      if (!map.has(k)) {
        map.set(k, { key: k, label: labelFromKey(k), items: [] })
      }
    }
    const list = Array.from(map.values())
    list.sort((a, b) => (a.key < b.key ? 1 : -1))
    return list
  })()

  const firstDayOfGroupMonth = (groupKey: string) => {
    // groupKey is YYYY-MM
    return `${groupKey}-01`
  }

  type FixedRow = { category: string; paid: boolean; tx?: Tx }

  const fixedRowsByGroup: Record<string, FixedRow[]> = (() => {
    const result: Record<string, FixedRow[]> = {}
    for (const group of allGroups) {
      const rows: FixedRow[] = fixedCategories.map(cat => {
        const tx = group.items.find(
          it => it.category.name === cat
        )
        return { category: cat, paid: Boolean(tx), tx }
      })
      result[group.key] = rows
    }
    return result
  })()

  const handleAddNewMonth = () => {
    // Tomar el último mes visible entre allGroups o, si no hay, el mes actual
    const lastKey = allGroups.length > 0
      ? allGroups[0].key // allGroups está ordenado desc
      : (() => {
          const d = new Date()
          const y = d.getFullYear()
          const m = d.getMonth() + 1
          return `${y}-${String(m).padStart(2, '0')}`
        })()
    const newKey = nextMonthKey(lastKey)
    setExtraMonths(prev => (prev.includes(newKey) ? prev : [newKey, ...prev]))
  }

  return (
    <main className="p-4">
      <div className="sticky top-0 z-20 -mx-4 px-4 pt-2 pb-3 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Gastos</h1>
          <div className="flex items-center gap-2">
            <div className="bg-gray-100 rounded-full p-1">
              <button
                className={`px-3 py-1.5 rounded-full text-sm ${modeTab === 'variable' ? 'bg-white shadow' : ''}`}
                onClick={() => setModeTab('variable')}
              >
                Variables
              </button>
              <button
                className={`px-3 py-1.5 rounded-full text-sm ${modeTab === 'fixed' ? 'bg-white shadow' : ''}`}
                onClick={() => setModeTab('fixed')}
              >
                Fijos
              </button>
            </div>
            {modeTab === 'variable' ? (
              <button
                onClick={() => {
                  const today = new Date()
                  const yyyy = today.getFullYear()
                  const mm = String(today.getMonth() + 1).padStart(2, '0')
                  const dd = String(today.getDate()).padStart(2, '0')
                  const todayStr = `${yyyy}-${mm}-${dd}`
                  setSelectedVar({
                    amount: '',
                    date: todayStr,
                    description: '',
                    category_id: null,
                    new_category: ''
                  } as ExpenseForm)
                  setShowVarModal(true)
                }}
                className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-full shadow-sm transition"
              >
                + Agregar
              </button>
            ) : (
              <button
                onClick={handleAddNewMonth}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-sm transition"
              >
                Nuevo mes
              </button>
            )}
          </div>
        </div>
        <div className="mt-3">
          <input
            type="text"
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
            placeholder="Filtrar por fecha, categoría o descripción…"
            className="w-full px-3 py-2.5 border rounded-xl shadow-sm focus:outline-none focus:ring"
          />
        </div>
      </div>


      {error && <p className="text-red-600 mb-4">{error}</p>}

      <div className="space-y-6">
        {allGroups.map(group => (
          <section key={group.key}>
            <header className="flex items-center justify-between mb-2 text-sm">
              <h2 className="text-lg font-semibold">{group.label}</h2>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-gray-500 hidden sm:inline">
                  {group.items.length} {group.items.length === 1 ? 'movimiento' : 'movimientos'}
                </span>
                <span className="font-medium">
                  Total: ${money(monthTotals[group.key] ?? 0)}
                </span>
              </div>
            </header>
            {modeTab === 'fixed' ? (
              <div>
                <ul className="space-y-2">
                  {fixedRowsByGroup[group.key].map(row => {
                    const inputKey = `${group.key}__${row.category}`
                    const val = payInputs[inputKey] ?? ''
                    const isEditingPaid = editingRows[inputKey] === true
                    return (
                      <li
                        key={`${group.key}-${row.category}`}
                        className="grid grid-cols-[1fr_auto_auto] gap-2 items-center p-3 bg-white rounded-xl shadow-sm ring-1 ring-black/5"
                      >
                        {/* Left: Category */}
                        <span className="truncate">{row.category}</span>

                        {/* Center: Amount (text if paid & not editing; input otherwise) */}
                        <span className="flex justify-end mr-0">
                          {row.paid && !isEditingPaid ? (
                            <span className="inline-block w-28 text-right font-medium">
                              ${money(row.tx!.amount)}
                            </span>
                          ) : (
                            <input
                              type="number"
                              inputMode="decimal"
                              placeholder="Monto"
                              value={val}
                              onChange={e => setPayInputs(prev => ({ ...prev, [inputKey]: e.target.value }))}
                              className="w-28 px-2 py-1.5 border rounded-lg text-right"
                            />
                          )}
                        </span>

                        {/* Right: Acción (sin badge de estado) */}
                        <div className="flex items-center justify-end gap-2">
                          {row.paid ? (
                            isEditingPaid ? (
                              <>
                                <button
                                  onClick={() => payFixed(group.key, row.category, val || String(row.tx!.amount), row.tx)}
                                  disabled={!val && !(row.tx && row.tx.amount)}
                                  className="px-3 py-1 rounded text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                                >
                                  Guardar
                                </button>
                                <button
                                  onClick={() => {
                                    setEditingRows(prev => ({ ...prev, [inputKey]: false }))
                                    setPayInputs(prev => ({ ...prev, [inputKey]: '' }))
                                  }}
                                  className="px-3 py-1 rounded text-sm bg-gray-200 text-gray-700 hover:bg-gray-300"
                                >
                                  Cancelar
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => {
                                  setEditingRows(prev => ({ ...prev, [inputKey]: true }))
                                  setPayInputs(prev => ({ ...prev, [inputKey]: String(row.tx!.amount) }))
                                }}
                                className="px-3 py-1 rounded text-sm bg-gray-200 text-gray-700 hover:bg-gray-300"
                              >
                                Editar
                              </button>
                            )
                          ) : (
                            <button
                              onClick={() => payFixed(group.key, row.category, val, row.tx)}
                              disabled={!val}
                              className="px-3 py-1 rounded text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              Pagar
                            </button>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : (
              <ul className="space-y-2">
                {group.items.map(tx => (
                  <li
                    key={tx.id}
                    onClick={() => {
                      setSelectedVar({
                        id: tx.id,
                        category_id: tx.category_id,
                        amount: String(tx.amount),
                        date: tx.date,
                        description: tx.description || '',
                        new_category: tx.category.name
                      } as ExpenseForm)
                      setShowVarModal(true)
                    }}
                    className="cursor-pointer p-3 bg-white rounded-xl shadow-sm ring-1 ring-black/5 hover:bg-gray-50 transition"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-gray-900 truncate">
                          {tx.description || '-'}
                        </p>
                        <div className="mt-0.5 text-xs text-gray-500 flex items-center gap-2 min-w-0">
                          <span className="truncate">
                            {tx.category.name}
                          </span>
                          {tx.payment_type === 'credito' ? (
                            <span className="px-1.5 py-0.5 rounded-full bg-blue-600 text-white text-[10px]">Crédito</span>
                          ) : tx.payment_type === 'debito' ? (
                            <span className="px-1.5 py-0.5 rounded-full bg-green-600 text-white text-[10px]">Débito</span>
                          ) : null}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[13px] font-semibold tabular-nums">${money(tx.amount)}</div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {showVarModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowVarModal(false)}
          />
          <div className="relative bg-white w-full max-w-md rounded-lg shadow-lg">
            <ExpenseModal
              initial={selectedVar || undefined}
              onClose={() => setShowVarModal(false)}
              onSaved={() => {
                setShowVarModal(false)
                loadTxs()
                setFilterText('')
              }}
              onDelete={() => {
                setShowVarModal(false)
                loadTxs()
                setFilterText('')
              }}
            />
          </div>
        </div>
      )}
    </main>
  )
}

export default Expenses
