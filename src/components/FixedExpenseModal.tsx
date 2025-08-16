// src/pages/expenses.tsx
// ... existing imports and code ...

  const firstDayOfGroupMonth = (groupKey: string) => {
    // groupKey is YYYY-MM
    return `${groupKey}-01`
  }

  type FixedRow = { category: string; paid: boolean; tx?: Tx }

  const [payInputs, setPayInputs] = useState<Record<string, string>>({})
  const [extraMonths, setExtraMonths] = useState<string[]>([])

  const monthLabel = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('es-ES', { year: 'numeric', month: 'long' })
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
    // ... existing grouping logic ...
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
      subcategory_id: existingTx?.subcategory_id ?? null,
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
    await loadTxs()
  }

// ... inside the JSX render, find the block rendering header actions ...

          {modeTab === 'variable' && (
            <button
              onClick={() => {
                setSelectedVar(null)
                setShowVarModal(true)
              }}
              className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-full shadow-sm transition"
            >
              + Agregar Gasto
            </button>
          )}
          {modeTab === 'fixed' && (
            <button
              onClick={handleAddNewMonth}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-sm transition"
            >
              Nuevo mes
            </button>
          )}

// ... inside the JSX render, find the block rendering groups ...

      <div className="space-y-6">
        {allGroups.map(group => (
          <div key={group.key}>
            <h3 className="text-lg font-semibold mb-2">{group.label}</h3>

            {modeTab === 'fixed' ? (
              <ul className="space-y-2">
                {fixedRowsByGroup[group.key].map(row => {
                  const inputKey = `${group.key}__${row.category}`
                  const val = payInputs[inputKey] ?? ''
                  return (
                    <li
                      key={`${group.key}-${row.category}`}
                      className="flex items-center justify-between p-3 bg-white rounded shadow-sm"
                    >
                      <span className="flex-1 flex items-center gap-2">
                        {row.category}
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${row.paid ? 'border-green-300 text-green-700' : 'border-gray-300 text-gray-600'}`}>
                          {row.paid ? 'Pagado' : 'Pendiente'}
                        </span>
                      </span>
                      <span className="flex-1 text-sm text-gray-500">{group.label}</span>
                      <div className="flex items-center gap-2">
                        {row.paid ? (
                          <span className="w-28 text-right font-medium">${row.tx!.amount.toFixed(2)}</span>
                        ) : (
                          <>
                            <input
                              type="number"
                              inputMode="decimal"
                              placeholder="Monto"
                              value={val}
                              onChange={e => setPayInputs(prev => ({ ...prev, [inputKey]: e.target.value }))}
                              className="w-28 px-2 py-1 border rounded text-right"
                            />
                            <button
                              onClick={() => payFixed(group.key, row.category, val, row.tx)}
                              disabled={!val}
                              className="px-3 py-1 rounded text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              Pagar
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <ul className="space-y-2">
                {group.items.map(tx => (
                  <li
                    key={tx.id}
                    onClick={() => {
                      if (tx.expense_mode === 'variable') {
                        setSelectedVar({
                          id: tx.id,
                          category_id: tx.category_id,
                          subcategory_id: tx.subcategory_id,
                          amount: String(tx.amount),
                          date: tx.date,
                          description: tx.description || '',
                          expense_mode: 'variable',
                          payment_type: 'debit',
                          installments: '',
                          tags: '',
                          new_category: tx.category.name,
                          new_subcategory: tx.subcategory?.name || ''
                        })
                        setShowVarModal(true)
                      } else {
                        setSelectedFixed({
                          id: tx.id,
                          category_id: tx.category_id,
                          subcategory_id: tx.subcategory_id,
                          amount: String(tx.amount),
                          date: tx.date,
                          description: tx.description || '',
                          expense_mode: 'fixed',
                          payment_type: 'transfer',
                          installments: '',
                          tags: '',
                          new_category: tx.category.name,
                          new_subcategory: tx.subcategory?.name || ''
                        })
                        setShowFixedModal(true)
                      }
                    }}
                    className="cursor-pointer flex justify-between p-3 bg-white rounded shadow-sm hover:bg-gray-50 transition"
                  >
                    <span className="flex-1 flex items-center gap-2">
                      {tx.category.name}
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${tx.expense_mode === 'fixed' ? 'border-blue-300 text-blue-700' : 'border-amber-300 text-amber-700'}`}>
                        {tx.expense_mode === 'fixed' ? 'Fijo' : 'Variable'}
                      </span>
                    </span>
                    <span className="flex-1">{tx.subcategory?.name || '-'}</span>
                    <span className="flex-1">{tx.description || '-'}</span>
                    <span className="w-24 text-right">${tx.amount.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

// ... rest of the file ...