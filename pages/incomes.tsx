// src/pages/incomes.tsx
import { NextPage } from 'next'
import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import IncomeModal from '../src/components/IncomeModal'

type Income = {
  id: number
  amount: number
  date: string
  description: string | null
  category_id: number | null
  category: { name: string }
}

const MONTHS_ES_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

const money = (n: number) => new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

const parseYearMonth = (dateStr: string) => {
  const m = dateStr.match(/^(\d{4})-(\d{2})/)
  if (m) {
    return { year: parseInt(m[1], 10), month: parseInt(m[2], 10) }
  }
  const d = new Date(dateStr)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

const Incomes: NextPage = () => {
  const [inc, setInc] = useState<Income[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [selected, setSelected] = useState<Income | null>(null)
  const [loading, setLoading] = useState(true)
  const [filterText, setFilterText] = useState('')

  const loadIncomes = async () => {
    setError(null)
    setLoading(true)
    try {
      const {
        data: { session }
      } = await supabase.auth.getSession()
      if (!session) {
        setInc([])
        return
      }
      const uid = session.user.id

      const { data, error } = await supabase
        .from('incomes')
        .select(`
          id,
          amount,
          date,
          description,
          category_id,
          category:category_id(name)
        `)
        .eq('user_id', uid)
        .order('date', { ascending: false })

      if (error) {
        console.error(error)
        setError(error.message)
        setInc([])
      } else if (data && data.length > 0) {
        const mapped: Income[] = data.map(item => {
          const catField = (item as any).category
          const categoryName = Array.isArray(catField)
            ? (catField[0]?.name ?? '')
            : (catField?.name ?? '')
          return {
            id: item.id,
            amount: item.amount,
            date: item.date,
            description: item.description,
            category_id: (item as any).category_id ?? null,
            category: { name: categoryName }
          }
        })
        setInc(mapped)
      } else {
        // sin datos
        setInc([])
      }
    } catch (e: any) {
      console.error(e)
      setError(e?.message ?? 'Error inesperado')
      setInc([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadIncomes()
  }, [])

  const grouped = React.useMemo(() => {
    const groups: Record<string, { label: string; items: Income[]; total: number }> = {}
    const source = inc.filter(i => {
      const t = filterText.toLowerCase()
      return [i.date, i.category.name, i.description ?? ''].join(' ').toLowerCase().includes(t)
    })
    source.forEach(item => {
      const { year, month } = parseYearMonth(item.date)
      const monthKey = `${year}-${month.toString().padStart(2, '0')}`
      const monthLabel = `${MONTHS_ES_SHORT[month - 1]} ${year}`
      if (!groups[monthKey]) {
        groups[monthKey] = { label: monthLabel, items: [], total: 0 }
      }
      groups[monthKey].items.push(item)
      groups[monthKey].total += item.amount
    })
    return Object.entries(groups)
      .sort((a, b) => (a[0] > b[0] ? -1 : 1))
      .map(([_, val]) => val)
  }, [inc, filterText])

  return (
    <main className="p-4">
      <div className="sticky top-0 z-20 -mx-4 px-4 pt-2 pb-3 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Ingresos</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setSelected(null); setShowModal(true) }}
              className="px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white rounded-full shadow-sm transition"
            >
              + Agregar
            </button>
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

      {loading && (
        <div className="my-6 text-sm text-gray-500">Cargando ingresos…</div>
      )}

      {error && <p className="text-red-600 mb-4">{error}</p>}

      {!loading && !error && inc.length === 0 && (
        <div className="my-6 rounded border border-dashed border-gray-300 p-6 text-center text-gray-600">
          <p className="mb-3">Todavía no registraste ingresos.</p>
          <button
            onClick={() => { setSelected(null); setShowModal(true) }}
            className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-full shadow-sm transition"
          >
            + Agregar tu primer ingreso
          </button>
        </div>
      )}

      {!loading && !error && grouped.map(group => (
        <section key={group.label} className="mb-6">
          <h2 className="text-lg font-semibold mb-2 flex items-center justify-between border-b border-gray-200 pb-1 text-sm">
            <span>{group.label}</span>
            <span className="text-sm text-gray-600">{group.items.length} {group.items.length === 1 ? 'movimiento' : 'movimientos'}
              <span className="ml-3 font-semibold text-gray-800">Total: ${money(group.total)}</span>
            </span>
          </h2>
          <ul className="space-y-2">
            {group.items.map(i => (
              <li
                key={i.id}
                className="grid grid-cols-[1fr_auto_auto] gap-2 items-center p-3 bg-white rounded-xl shadow-sm ring-1 ring-black/5"
              >
                {/* Izquierda: Categoría (y tooltip con descripción si existe) */}
                <span className="truncate" title={i.description || ''}>{i.category.name}</span>

                {/* Centro: Monto alineado a la derecha */}
                <span className="flex justify-end">
                  <span className="inline-block w-32 text-right font-semibold tabular-nums">${money(i.amount)}</span>
                </span>

                {/* Derecha: Acción Editar que abre el modal */}
                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      setSelected(i)
                      setShowModal(true)
                    }}
                    className="px-3 py-1 rounded text-sm bg-gray-200 text-gray-700 hover:bg-gray-300"
                  >
                    Editar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {showModal && (
        <IncomeModal
          onClose={() => setShowModal(false)}
          onSaved={() => {
            setShowModal(false)
            loadIncomes()
          }}
          income={selected ? {
            id: selected.id,
            amount: selected.amount,
            date: selected.date,
            description: selected.description ?? '',
            category_id: selected.category_id ?? null,
          } : null}
        />
      )}
    </main>
  )
}

export default Incomes
