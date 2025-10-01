// src/pages/index.tsx
import { NextPage } from 'next'
import { useRouter } from 'next/router'
import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import ExpenseModal from '../src/components/ExpenseModal'
import IncomeModal from '../src/components/IncomeModal'
// import EmailIngestButton from '@/components/EmailIngestButton' // removed, using icon-only button
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ArrowPathIcon,
  CurrencyDollarIcon,
  PlusIcon,
  MinusIcon
} from '@heroicons/react/24/outline'

// Formatting helpers
const formatARS = (n: number) =>
  n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  const label = d.toLocaleString('es-AR', { month: 'long' });
  return label.charAt(0).toUpperCase() + label.slice(1);
};

const ymAddMonths = (ym: string, delta: number) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const shortMonthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1, 1)
  const month = d.toLocaleString('es-AR', { month: 'short' })
  return `${month.charAt(0).toUpperCase() + month.slice(1)} ${y}`
}

const Amount: React.FC<{ value: number; negative?: boolean; className?: string }> = ({
  value,
  negative,
  className
}) => {
  const sign = negative ? '-' : '';
  return (
    <span className={`tabular-nums ${negative ? 'text-red-600' : ''} ${className || ''}`}>
      {sign}${formatARS(value)}
    </span>
  );
};

type CategoryAmount = { name: string; total: number }

const Dashboard: NextPage = () => {
  const router = useRouter()
  const [sessionChecked, setSessionChecked] = useState<boolean | null>(null)
  const [loadingData, setLoadingData] = useState(false)
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  const [incomesByCategory, setIncomesByCategory] = useState<CategoryAmount[]>([])
  const [totalIncomes, setTotalIncomes] = useState(0)
  const [devolucionesTotal, setDevolucionesTotal] = useState(0)
  const [fixedExpensesByCategory, setFixedExpensesByCategory] = useState<CategoryAmount[]>([])
  const [totalFixedExpenses, setTotalFixedExpenses] = useState(0)
  const [variableExpensesByCategory, setVariableExpensesByCategory] = useState<CategoryAmount[]>([])
  const [totalVariableExpenses, setTotalVariableExpenses] = useState(0)
  const [variableSubcategoriesByCategory, setVariableSubcategoriesByCategory] = useState<
    Record<string, CategoryAmount[]>
  >({})
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({})
  const [showExpenseModal, setShowExpenseModal] = useState(false)
  const [showIncomeModal, setShowIncomeModal] = useState(false)
  const [prevBalances, setPrevBalances] = useState<{ ym: string; balance: number }[]>([])
  const [ytdBalance, setYtdBalance] = useState(0)

  // Email sync UI state
  const [syncingEmails, setSyncingEmails] = useState(false)

  const [uncategorized, setUncategorized] = useState<Array<{
    id: number;
    date: string;
    description: string | null;
    amount: number;
    currency?: string | null;
    category_id: string | null;
    subcategory_id: string | null;
  }>>([])
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([])
  const [subcategories, setSubcategories] = useState<Array<{ id: string; name: string; category_id?: string | null }>>([])
  const [savingIds, setSavingIds] = useState<Record<number, boolean>>({})
  const [selection, setSelection] = useState<Record<number, { category_id: string | null; subcategory_id: string | null }>>({})

  const toggleCategory = (name: string) =>
    setExpandedCategories(prev => ({ ...prev, [name]: !prev[name] }))

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      router.replace('/login');
    } catch (_) {}
  };


  // 1) Comprobar sesión
  useEffect(() => {
    const check = async () => {
      const {
        data: { session }
      } = await supabase.auth.getSession()
      if (!session) router.replace('/login')
      else setSessionChecked(true)
    }
    check()
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) router.replace('/login')
    })
    return () => listener.subscription.unsubscribe()
  }, [router])

  // 2) Fetch datos
  useEffect(() => {
    if (!sessionChecked) return
    const fetchData = async () => {
      setLoadingData(true)
      const {
        data: { session }
      } = await supabase.auth.getSession()
      if (!session) return
      const uid = session.user.id
      const [y, m] = selectedMonth.split('-').map(Number)
      const start = `${y}-${String(m).padStart(2, '0')}-01`
      const lastDay = new Date(y, m, 0).getDate()
      const end = `${y}-${String(m).padStart(2, '0')}-${lastDay}`

      // Ingresos
      const { data: incs } = await supabase
        .from('incomes')
        .select('category:category_id(name),amount')
        .eq('user_id', uid)
        .gte('date', start)
        .lte('date', end)
      const mapInc: Record<string, number> = {}
      incs?.forEach(i => {
        const cat = (i as any).category
        const name = Array.isArray(cat) ? cat[0]?.name : cat?.name
        mapInc[name || '–'] = (mapInc[name || '–'] || 0) + i.amount
      })
      const devol = mapInc['Devolución'] || 0
      delete mapInc['Devolución']
      const incArr = Object.entries(mapInc).map(([n, t]) => ({ name: n, total: t })).sort((a,b) => b.total - a.total)
      setIncomesByCategory(incArr)
      setTotalIncomes(incArr.reduce((s, x) => s + x.total, 0))
      setDevolucionesTotal(devol)

      // Gastos
      const { data: txs } = await supabase
        .from('transactions')
        .select('category:category_id(name),subcategory:subcategory_id(name),amount,expense_mode')
        .eq('user_id', uid)
        .gte('date', start)
        .lte('date', end)
      const fixedMap: Record<string, number> = {}
      const variableMap: Record<string, number> = {}
      const subByCat: Record<string, Record<string, number>> = {}
      const EXCLUDED_FIXED = new Set(['Tarjeta Visa', 'Tarjeta Master'])
      txs?.forEach(t => {
        const cat = Array.isArray((t as any).category)
          ? (t as any).category[0]?.name
          : (t as any).category?.name
        if (t.expense_mode === 'fixed') {
          if (!EXCLUDED_FIXED.has(cat)) {
            fixedMap[cat] = (fixedMap[cat] || 0) + t.amount
          }
        } else {
          variableMap[cat] = (variableMap[cat] || 0) + t.amount
          const sub = (t as any).subcategory
          const subName = Array.isArray(sub) ? sub[0]?.name : sub?.name
          if (subName) {
            subByCat[cat] = subByCat[cat] || {}
            subByCat[cat][subName] = (subByCat[cat][subName] || 0) + t.amount
          }
        }
      })
      const toArr = (m: Record<string, number>) => Object.entries(m).map(([n, t]) => ({ name: n, total: t }))
      const fixedArr = toArr(fixedMap).sort((a,b) => b.total - a.total); setFixedExpensesByCategory(fixedArr); setTotalFixedExpenses(fixedArr.reduce((s, x) => s + x.total, 0))
      const varArr   = toArr(variableMap).sort((a,b) => b.total - a.total); setVariableExpensesByCategory(varArr); setTotalVariableExpenses(varArr.reduce((s, x) => s + x.total, 0))
      const subCats: Record<string, CategoryAmount[]> = {}; Object.entries(subByCat).forEach(([c,m])=>subCats[c]=toArr(m).sort((a,b) => b.total - a.total)); setVariableSubcategoriesByCategory(subCats)

      // Catálogo de categorías y subcategorías
      const { data: cats } = await supabase
        .from('categories')
        .select('id,name')
        .order('name', { ascending: true })

      const { data: subs } = await supabase
        .from('subcategories')
        .select('id,name,category_id')
        .order('name', { ascending: true })

      // De-duplicate by normalized name to evitar repetidos visibles (base de datos puede tener entradas duplicadas)
      const normalize = (s: string) => (s || '').trim().toLowerCase()
      const uniqueCatMap = new Map<string, { id: string; name: string }>()
      ;(cats || []).forEach((c: any) => {
        const key = normalize(c.name)
        if (!uniqueCatMap.has(key)) uniqueCatMap.set(key, { id: String(c.id), name: c.name })
      })
      const catsUnique = Array.from(uniqueCatMap.values())

      // Subcategorías: asegurar strings y mantener todas, ya que pueden repetirse nombres en distintas categorías
      const subsNorm = (subs || []).map((s: any) => ({ id: String(s.id), name: s.name, category_id: s.category_id ? String(s.category_id) : null }))

      setCategories(catsUnique)
      setSubcategories(subsNorm)

      // Gastos sin categoría para el mes seleccionado (ignorar los que sí tienen categoría aunque falte la subcategoría)
      const { data: unc } = await supabase
        .from('transactions')
        .select('id,date,description,amount,currency,category_id,subcategory_id')
        .eq('user_id', uid)
        .gte('date', start)
        .lte('date', end)
        .is('category_id', null)
        .order('date', { ascending: false })
      setUncategorized((unc || []) as any)

      // Inicializar selección local con lo que ya tengan (para que aparezca preseleccionado)
      const sel: Record<number, { category_id: string | null; subcategory_id: string | null }> = {}
      ;(unc || []).forEach((t: any) => {
        sel[t.id] = { category_id: t.category_id ?? null, subcategory_id: t.subcategory_id ?? null }
      })
      setSelection(sel)

      // --- Balances de meses anteriores y acumulado ---
      const prev1 = ymAddMonths(selectedMonth, -1)
      const prev2 = ymAddMonths(selectedMonth, -2)
      const prev3 = ymAddMonths(selectedMonth, -3)

      const rangeStartPrev3 = `${prev3.split('-')[0]}-${prev3.split('-')[1]}-01`
      const endSelected = end // ya calculado arriba

      // Traer ingresos del rango prev3..selected
      const { data: incRange } = await supabase
        .from('incomes')
        .select('category:category_id(name), amount, date')
        .eq('user_id', uid)
        .gte('date', rangeStartPrev3)
        .lte('date', endSelected)

      // Traer gastos del rango prev3..selected
      const { data: txRange } = await supabase
        .from('transactions')
        .select('category:category_id(name), subcategory:subcategory_id(name), amount, expense_mode, date')
        .eq('user_id', uid)
        .gte('date', rangeStartPrev3)
        .lte('date', endSelected)

      const monthsTarget = new Set([prev1, prev2, prev3])

      // Acumuladores por mes (YYYY-MM)
      const monthAgg: Record<string, { inc: number; devol: number; fix: number; vari: number }> = {}

      const ymFromDate = (iso: string) => {
        const [yy, mm] = iso.split('-')
        return `${yy}-${mm}`
      }

      // Ingresos por mes (separando Devolución)
      incRange?.forEach((i: any) => {
        const ym = ymFromDate(i.date)
        if (!monthsTarget.has(ym)) return
        const cat = Array.isArray(i.category) ? i.category[0]?.name : i.category?.name
        monthAgg[ym] = monthAgg[ym] || { inc: 0, devol: 0, fix: 0, vari: 0 }
        if (cat === 'Devolución') monthAgg[ym].devol += i.amount
        else monthAgg[ym].inc += i.amount
      })

      // Gastos por mes
      txRange?.forEach((t: any) => {
        const ym = ymFromDate(t.date)
        if (!monthsTarget.has(ym)) return
        const cat = Array.isArray(t.category) ? t.category[0]?.name : t.category?.name
        monthAgg[ym] = monthAgg[ym] || { inc: 0, devol: 0, fix: 0, vari: 0 }
        if (t.expense_mode === 'fixed') {
          if (!EXCLUDED_FIXED.has(cat)) monthAgg[ym].fix += t.amount
        } else {
          monthAgg[ym].vari += t.amount
        }
      })

      // Calcular balances para prev1, prev2, prev3
      const computeBal = (ym: string) => {
        const a = monthAgg[ym] || { inc: 0, devol: 0, fix: 0, vari: 0 }
        const netVar = a.vari - a.devol
        return (a.inc) - (a.fix + netVar)
      }

      const prevBalancesArr = [prev1, prev2, prev3]
        .map(ym => ({ ym, balance: computeBal(ym) }))

      setPrevBalances(prevBalancesArr)

      // Acumulado del año (YTD) hasta el fin del mes seleccionado
      const year = String(y)
      const ytdStart = `${year}-01-01`

      const { data: incYTD } = await supabase
        .from('incomes')
        .select('category:category_id(name), amount, date')
        .eq('user_id', uid)
        .gte('date', ytdStart)
        .lte('date', endSelected)

      const { data: txYTD } = await supabase
        .from('transactions')
        .select('category:category_id(name), amount, expense_mode, date')
        .eq('user_id', uid)
        .gte('date', ytdStart)
        .lte('date', endSelected)

      let incY = 0, devolY = 0, fixY = 0, variY = 0
      incYTD?.forEach((i: any) => {
        const cat = Array.isArray(i.category) ? i.category[0]?.name : i.category?.name
        if (cat === 'Devolución') devolY += i.amount
        else incY += i.amount
      })
      txYTD?.forEach((t: any) => {
        const cat = Array.isArray(t.category) ? t.category[0]?.name : t.category?.name
        if (t.expense_mode === 'fixed') {
          if (!EXCLUDED_FIXED.has(cat)) fixY += t.amount
        } else {
          variY += t.amount
        }
      })
      const netVarY = variY - devolY
      setYtdBalance(incY - (fixY + netVarY))

      setLoadingData(false)
    }
    fetchData()
  }, [selectedMonth, sessionChecked])

  const reloadUncategorized = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const uid = session.user.id
    const [y, m] = selectedMonth.split('-').map(Number)
    const start = `${y}-${String(m).padStart(2, '0')}-01`
    const lastDay = new Date(y, m, 0).getDate()
    const end = `${y}-${String(m).padStart(2, '0')}-${lastDay}`
    const { data: unc } = await supabase
      .from('transactions')
      .select('id,date,description,amount,currency,category_id,subcategory_id')
      .eq('user_id', uid)
      .gte('date', start)
      .lte('date', end)
      .is('category_id', null)
      .order('date', { ascending: false })
    setUncategorized((unc || []) as any)
    const sel: Record<number, { category_id: string | null; subcategory_id: string | null }> = {}
    ;(unc || []).forEach((t: any) => { sel[t.id] = { category_id: t.category_id ?? null, subcategory_id: t.subcategory_id ?? null } })
    setSelection(sel)
  }

  const handleEmailRefresh = async () => {
    try {
      setSyncingEmails(true)
      const secret = process.env.NEXT_PUBLIC_EMAIL_INGEST_SECRET || ''
      const { data: { session } } = await supabase.auth.getSession()
      const uid = session?.user?.id
      if (!uid) { console.warn('[EmailSync] No session user'); return }

      // 1) Sync
      const syncRes = await fetch('/api/email/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-email-secret': secret },
        body: JSON.stringify({ user_id: uid, limit: 200, days: 30 })
      })
      if (!syncRes.ok) throw new Error(`sync failed: ${syncRes.status}`)

      // 2) Promote
      const promoteRes = await fetch('/api/email/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-email-secret': secret },
        body: JSON.stringify({ user_id: uid, limit: 60 })
      })
      if (!promoteRes.ok) throw new Error(`promote failed: ${promoteRes.status}`)

      // Refresh only uncategorized list so the user sees new items
      await reloadUncategorized()
    } catch (e) {
      console.error('[EmailSync] error', e)
    } finally {
      setSyncingEmails(false)
    }
  }

  // --- Helper functions for categorization ---
  const getMonthRange = (ym: string) => {
    const [y, m] = ym.split('-').map(Number)
    const start = `${y}-${String(m).padStart(2, '0')}-01`
    const end = `${y}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
    return { start, end }
  }

  const humanDate = (iso: string) => {
    try {
      const d = new Date(iso)
      return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
    } catch { return iso }
  }

  const updateSelection = (id: number, field: 'category_id'|'subcategory_id', value: string | null) => {
    setSelection(prev => ({ ...prev, [id]: { ...(prev[id] || { category_id: null, subcategory_id: null }), [field]: value } }))
  }

  // --- Helpers for creating categories and subcategories ---
  const NEW_CATEGORY_VALUE = '__new_cat__'
  const NEW_SUBCATEGORY_VALUE = '__new_sub__'
  const QUICK_CAT_NAMES = ['Alimentación', 'Comidas afuera', 'Salud', 'Varios']

  const createCategory = async (): Promise<{ id: string; name: string } | null> => {
    const name = window.prompt('Nueva categoría')?.trim()
    if (!name) return null
    try {
      const { data, error } = await supabase
        .from('categories')
        .insert({ name })
        .select('id,name')
        .single()
      if (error) throw error
      const created = { id: String(data.id), name: data.name }
      setCategories(prev => {
        const exists = prev.some(c => c.name.trim().toLowerCase() === created.name.trim().toLowerCase())
        return exists ? prev : [...prev, created].sort((a,b) => a.name.localeCompare(b.name))
      })
      return created
    } catch (e:any) {
      alert(e?.message || 'No se pudo crear la categoría')
      return null
    }
  }

  const createSubcategory = async (categoryId: string): Promise<{ id: string; name: string; category_id: string } | null> => {
    const name = window.prompt('Nueva subcategoría')?.trim()
    if (!name) return null
    try {
      const { data, error } = await supabase
        .from('subcategories')
        .insert({ name, category_id: categoryId })
        .select('id,name,category_id')
        .single()
      if (error) throw error
      const created = { id: String(data.id), name: data.name, category_id: String(data.category_id) }
      setSubcategories(prev => [...prev, created].sort((a,b) => a.name.localeCompare(b.name)))
      return created
    } catch (e:any) {
      alert(e?.message || 'No se pudo crear la subcategoría')
      return null
    }
  }

  const saveCategorization = async (id: number) => {
    const sel = selection[id] || { category_id: null, subcategory_id: null }
    if (!sel.category_id) return alert('Elegí una categoría primero.')
    setSavingIds(prev => ({ ...prev, [id]: true }))
    try {
      const { error } = await supabase
        .from('transactions')
        .update({
          category_id: sel.category_id,
          subcategory_id: sel.subcategory_id ?? null,
          expense_mode: 'variable'
        })
        .eq('id', id)
      if (error) throw error

      // Remover de la lista local
      setUncategorized(prev => prev.filter(t => t.id !== id))
    } catch (e:any) {
      alert(e?.message || String(e))
    } finally {
      setSavingIds(prev => ({ ...prev, [id]: false }))
    }
  }

  if (sessionChecked === null) return null

  const netVar = totalVariableExpenses - devolucionesTotal
  const totalExpenses = totalFixedExpenses + netVar
  const balance = totalIncomes - totalExpenses

  const quickCats = categories.filter(c => QUICK_CAT_NAMES.includes(c.name))

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 shadow-md bg-white">
        {/* Selector de mes y acciones */}
        <div className="mx-auto max-w-screen-md px-3 py-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-center">
          <div className="flex items-center justify-center gap-3">
            <button
              aria-label="Mes anterior"
              className="p-2 rounded-full hover:bg-gray-100 active:scale-95 transition"
              onClick={() => {
                const [y, m] = selectedMonth.split('-').map(Number)
                const prev = new Date(y, m - 2, 1)
                setSelectedMonth(`${prev.getFullYear()}-${String(prev.getMonth()+1).padStart(2,'0')}`)
              }}
            >
              <ChevronLeftIcon className="h-5 w-5 text-gray-700" />
            </button>

            <span className="text-xl sm:text-2xl font-bold tracking-tight">
              {monthLabel(selectedMonth)}
            </span>

            <button
              aria-label="Mes siguiente"
              className="p-2 rounded-full hover:bg-gray-100 active:scale-95 transition"
              onClick={() => {
                const [y, m] = selectedMonth.split('-').map(Number)
                const next = new Date(y, m, 1)
                setSelectedMonth(`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}`)
              }}
            >
              <ChevronRightIcon className="h-5 w-5 text-gray-700" />
            </button>
          </div>
        </div>
      </nav>
      <div className="pt-16">
        {/* Modales */}
        {showExpenseModal && (
          <div className="fixed inset-0 z-[60] flex items-start sm:items-center justify-center p-3 sm:p-6">
            <div
              className="absolute inset-0 bg-black/30 backdrop-blur-sm"
              onClick={() => setShowExpenseModal(false)}
            />
            <div className="relative w-full max-w-md sm:max-w-lg bg-white rounded-2xl shadow-xl ring-1 ring-black/10 overflow-hidden">
              <ExpenseModal
                onClose={() => setShowExpenseModal(false)}
                onSaved={() => { setShowExpenseModal(false); /* recarga data si quieres */ }}
              />
            </div>
          </div>
        )}
        {showIncomeModal && (
          <div className="fixed inset-0 z-[60] flex items-start sm:items-center justify-center p-3 sm:p-6">
            <div
              className="absolute inset-0 bg-black/30 backdrop-blur-sm"
              onClick={() => setShowIncomeModal(false)}
            />
            <div className="relative w-full max-w-md sm:max-w-lg bg-white rounded-2xl shadow-xl ring-1 ring-black/10 overflow-hidden">
              <IncomeModal
                onClose={() => setShowIncomeModal(false)}
                onSaved={() => { setShowIncomeModal(false); /* recarga data si quieres */}}
              />
            </div>
          </div>
        )}

        {/* Floating action buttons */}
        <div className="fixed right-4 bottom-24 sm:bottom-28 z-40 flex flex-col gap-3">
          <button
            onClick={handleEmailRefresh}
            disabled={syncingEmails}
            aria-label="Actualizar desde emails"
            className="w-14 h-14 rounded-full bg-gray-900 text-white shadow-xl ring-1 ring-black/5 hover:bg-gray-800 active:scale-95 transition flex items-center justify-center disabled:opacity-50"
            title="Actualizar desde emails"
          >
            <ArrowPathIcon className={`w-7 h-7 ${syncingEmails ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowIncomeModal(true)}
            aria-label="Nuevo ingreso"
            className="w-14 h-14 rounded-full bg-green-500 text-white shadow-xl ring-1 ring-black/5 hover:bg-green-600 active:scale-95 transition flex items-center justify-center"
          >
            <PlusIcon className="w-7 h-7" />
          </button>
          <button
            onClick={() => setShowExpenseModal(true)}
            aria-label="Nuevo gasto"
            className="w-14 h-14 rounded-full bg-red-500 text-white shadow-xl ring-1 ring-black/5 hover:bg-red-600 active:scale-95 transition flex items-center justify-center"
          >
            <MinusIcon className="w-7 h-7" />
          </button>
        </div>

        {/* Cards */}
        <main className="mx-auto max-w-screen-xl p-4 pb-24 grid gap-4 grid-cols-1 lg:grid-cols-3">
          {/* 1. Balance section - first */}
          <section className="order-2 bg-white rounded-2xl shadow-sm ring-1 ring-black/5 p-6 flex flex-col lg:col-span-1 lg:col-start-1 lg:row-start-1">
            <header className="flex items-center mb-4">
              <CurrencyDollarIcon className="h-6 w-6 text-blue-500 mr-2" />
              <h3 className="text-lg font-semibold">Balance</h3>
            </header>
            <p className={`text-4xl font-bold ${balance<0?'text-red-600':'text-green-600'}`}>
              <Amount value={balance} />
            </p>
            <div className="mt-4 border-t pt-3 text-sm">
              <ul className="space-y-1">
                {prevBalances.map(({ ym, balance }) => (
                  <li key={ym} className="flex justify-between">
                    <span className="text-gray-500">{shortMonthLabel(ym)}</span>
                    <Amount value={Math.abs(balance)} negative={balance < 0} />
                  </li>
                ))}
                <li className="flex justify-between pt-1 border-t mt-2">
                  <span className="font-medium">Acumulado {selectedMonth.split('-')[0]}</span>
                  <Amount value={Math.abs(ytdBalance)} negative={ytdBalance < 0} />
                </li>
              </ul>
            </div>
          </section>
          {/* 2. Ingresos section - second */}
          <section className="order-3 bg-white rounded-2xl shadow-sm ring-1 ring-black/5 p-6 flex flex-col lg:col-span-1 lg:col-start-2 lg:row-start-1">
            <header className="flex items-center mb-4">
              <ArrowUpIcon className="h-6 w-6 text-green-500 mr-2" />
              <h3 className="text-lg font-semibold">Ingresos</h3>
            </header>
            <p className="text-3xl font-bold mb-4"><Amount value={totalIncomes} /></p>
            <ul className="divide-y space-y-1">
              {incomesByCategory.map(cat => (
                <li key={cat.name} className="py-1 flex justify-between text-sm">
                  <span>{cat.name}</span>
                  <Amount className="text-right" value={cat.total} />
                </li>
              ))}
              {devolucionesTotal>0 && (
                <li className="py-1 flex justify-between text-sm text-red-600">
                  <span>Devoluciones</span>
                  <Amount className="text-right" value={devolucionesTotal} negative />
                </li>
              )}
            </ul>
          </section>
          {/* 3. Gastos Fijos section - third */}
          <section className="order-4 bg-white rounded-2xl shadow-sm ring-1 ring-black/5 p-6 flex flex-col lg:col-span-1 lg:col-start-1 lg:row-start-2">
            <header className="flex items-center mb-4">
              <ArrowDownIcon className="h-6 w-6 text-red-500 mr-2" />
              <h3 className="text-lg font-semibold">Gastos Fijos</h3>
            </header>
            <p className="text-3xl font-bold mb-4"><Amount value={totalFixedExpenses} /></p>
            <ul className="divide-y space-y-1">
              {fixedExpensesByCategory.map(cat => (
                <li key={cat.name} className="py-1 flex justify-between text-sm">
                  <span>{cat.name}</span>
                  <Amount className="text-right" value={cat.total} />
                </li>
              ))}
            </ul>
          </section>
          {/* 4. Gastos Variables section - fourth */}
          <section className="order-5 bg-white rounded-2xl shadow-sm ring-1 ring-black/5 p-6 flex flex-col lg:col-span-1 lg:col-start-2 lg:row-start-2">
            <header className="flex items-center mb-4">
              <ArrowDownIcon className="h-6 w-6 text-orange-500 mr-2" />
              <h3 className="text-lg font-semibold">Gastos Variables</h3>
            </header>
            <p className="text-3xl font-bold mb-4"><Amount value={totalVariableExpenses} /></p>
            <ul className="divide-y space-y-1">
              {variableExpensesByCategory.map(cat => (
                <li key={cat.name}>
                  <button
                    onClick={() => toggleCategory(cat.name)}
                    className="w-full flex justify-between text-sm py-1"
                  >
                    <span>{cat.name}</span>
                    <Amount className="text-right" value={cat.total} />
                  </button>
                  {expandedCategories[cat.name] && variableSubcategoriesByCategory[cat.name] && (
                    <ul className="pl-4 space-y-1">
                      {variableSubcategoriesByCategory[cat.name].map(sub => (
                        <li key={sub.name} className="flex justify-between text-xs py-1">
                          <span className="italic">{sub.name}</span>
                          <Amount className="text-right" value={sub.total} />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </section>
          {/* 5. Por categorizar section - last */}
          <section className="order-1 bg-white rounded-2xl shadow-sm ring-1 ring-black/5 p-4 lg:p-6 flex flex-col lg:col-span-1 lg:col-start-3 lg:row-start-1">
            <header className="pb-2 mb-2 flex items-center justify-between border-b">
              <h3 className="text-lg font-semibold">Por categorizar</h3>
              <span className="hidden lg:inline text-xs text-gray-400 ml-2">Tip: en escritorio la lista usa el scroll de la página</span>
              <div className="shrink-0">
                <button
                  onClick={handleEmailRefresh}
                  disabled={syncingEmails}
                  aria-label="Actualizar desde emails"
                  className="hidden sm:inline-flex items-center justify-center size-9 rounded-full bg-gray-900 text-white shadow-sm ring-1 ring-black/5 hover:bg-gray-800 active:translate-y-px disabled:opacity-50"
                  title="Actualizar desde emails"
                >
                  <ArrowPathIcon className={`h-5 w-5 ${syncingEmails ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </header>

            {uncategorized.length === 0 ? (
              <p className="text-sm text-gray-500">No hay pendientes este mes 🎉</p>
            ) : (
              <>
                {/* Mobile-first list (phones) */}
                <ul className="space-y-3">
                  {uncategorized.map((tx) => {
                    const sel = selection[tx.id] || { category_id: null, subcategory_id: null }
                    return (
                      <li key={tx.id} className="bg-white rounded-xl shadow ring-1 ring-black/5 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs text-gray-500 leading-none">{humanDate(tx.date)}</p>
                            <p className="text-sm font-medium truncate mt-1">{tx.description || '—'}</p>
                          </div>
                          <p className="text-right font-semibold tabular-nums">${formatARS(tx.amount)}</p>
                        </div>

                        {quickCats.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {quickCats.map((c) => (
                              <button
                                key={c.id}
                                onClick={async () => {
                                  updateSelection(tx.id, 'category_id', c.id)
                                  updateSelection(tx.id, 'subcategory_id', null)
                                  try {
                                    await saveCategorization(tx.id)
                                  } catch {}
                                }}
                                className={`px-3 py-1.5 rounded-full text-sm transition ${
                                  sel.category_id === c.id
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                                }`}
                              >
                                {c.name}
                              </button>
                            ))}
                          </div>
                        )}

                        <div className="mt-3 grid grid-cols-1 gap-2">
                          <label className="block text-xs text-gray-500">Categoría</label>
                          <select
                            className="w-full border rounded-lg px-3 py-2 text-base min-h-[44px] bg-white"
                            value={sel.category_id || ''}
                            onChange={async (e) => {
                              const val = e.target.value || null
                              if (val === NEW_CATEGORY_VALUE) {
                                const created = await createCategory()
                                if (created) {
                                  updateSelection(tx.id, 'category_id', created.id)
                                  updateSelection(tx.id, 'subcategory_id', null)
                                }
                                return
                              }
                              updateSelection(tx.id, 'category_id', val)
                              updateSelection(tx.id, 'subcategory_id', null)
                            }}
                          >
                            <option value="">Elegí…</option>
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                            <option value={NEW_CATEGORY_VALUE}>+ Nueva categoría…</option>
                          </select>

                          <button
                            onClick={() => saveCategorization(tx.id)}
                            disabled={!!savingIds[tx.id] || !selection[tx.id]?.category_id}
                            className="mt-3 w-full px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {savingIds[tx.id] ? 'Guardando…' : 'Guardar'}
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>

              </>
            )}
          </section>
        </main>
        <div className="py-3 text-center">
          <button onClick={handleLogout} className="text-gray-400 text-xs underline">
            Cerrar sesión
          </button>
        </div>
      </div>
    </>
  )
}

export default Dashboard
