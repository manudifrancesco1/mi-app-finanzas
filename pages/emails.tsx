import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { createClient } from '@supabase/supabase-js'

type EmailRow = {
  id: number
  user_id: string
  date_local: string | null
  email_datetime: string | null
  merchant: string | null
  amount: number | null
  currency: string | null
  card_last4: string | null
  processed: boolean | null
  source: string | null
}

// Local browser Supabase client to avoid undefined imports
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
)

function prettifyMerchant(m: string | null): string {
  if (!m) return '—'
  // Normalizar espacios (incluye NBSP) y recortar
  const normalized = m.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim()
  // Cortar antes de cualquier metadato típico del cuerpo de la alerta
  const metaIdx = normalized.search(/\s*(Comercio:|Pa[ií]s:|Ciudad:|Tarjeta:|Autorizaci[oó]n:|Tipo de transacci[oó]n:|Moneda:|Monto:)/i)
  let name = metaIdx > 0 ? normalized.slice(0, metaIdx).trim() : normalized
  // Quitar prefijo "Comercio: " si viniera
  name = name.replace(/^Comercio:\s*/i, '')
  // Evitar nombres absurdamente largos por si falla el corte
  if (name.length > 80) name = name.slice(0, 80).trim()
  return name || '—'
}

function formatAmount(val: number | string | null, currency: string | null): string {
  if (val == null) return '—'
  const rawStr = (typeof val === 'string' ? val : String(val)).trim()
  // Remover separadores de miles que puedan venir como coma
  const cleaned = rawStr.replace(/,/g, '')
  let num = Number(cleaned)
  if (!Number.isFinite(num)) return '—'

  // Detectar si el string original ya trae parte decimal
  const hasDecimal = /[.,]\d{1,2}$/.test(rawStr)

  // Escalar sólo si parece venir en centavos (p.ej. 840000 -> 8400, 164900 -> 1649)
  // Regla: no hay decimales en el string y el absoluto es mayor o igual a 100000
  if (!hasDecimal && Math.abs(num) >= 100000) {
    num = num / 100
  }

  try {
    return num.toLocaleString('es-AR', { style: 'currency', currency: currency || 'ARS' })
  } catch {
    return num.toLocaleString('es-AR')
  }
}

export default function EmailsPage() {
  const router = useRouter()
  const [rows, setRows] = useState<EmailRow[]>([])
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const [processedFilter, setProcessedFilter] = useState<'all' | 'pending' | 'done'>('all')
  const [search, setSearch] = useState('')

  // proteger por login
  useEffect(() => {
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) router.replace('/login')
    }
    check()
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) router.replace('/login')
    })
    return () => {
      try {
        // Optional chaining in case the subscription shape differs
        // @ts-ignore
        sub?.subscription?.unsubscribe?.()
      } catch {}
    }
  }, [router])

  const load = async () => {
    setLoading(true)
    setMsg(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const uid = session?.user?.id
      if (!uid) return

      let q = supabase
        .from('email_transactions')
        .select('id,user_id,date_local,email_datetime,merchant,amount,currency,card_last4,processed,source')
        .order('email_datetime', { ascending: false })
        .limit(100)

      q = q.eq('user_id', uid!)

      if (processedFilter === 'pending') {
        q = q.eq('processed', false)
      } else if (processedFilter === 'done') {
        q = q.eq('processed', true)
      }
      if (search.trim()) {
        const s = `%${search.trim()}%`
        q = q.or(`merchant.ilike.${s},subject.ilike.${s}`)
      }

      const { data, error } = await q

      if (error) throw error
      setRows(data || [])
      setLastUpdated(new Date())
    } catch (e: any) {
      setMsg(`Error cargando emails: ${e?.message || String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [processedFilter])

  const trigger = async () => {
    setSyncing(true)
    setMsg(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const uid = session?.user?.id
      if (!uid) {
        throw new Error('No hay sesión activa')
      }

      // Usamos el proxy server-side que encadena SYNC + PROMOTE y usa el secret del servidor.
      const resp = await fetch('/api/email/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: uid, limit: 200, days: 30, debug: true }),
      })
      const json = await resp.json().catch(() => ({} as any))
      if (!resp.ok) {
        const err = json?.error || json?.sync?.details?.[0]?.error || json?.promote?.details?.[0]?.error || `trigger failed: ${resp.status}`
        throw new Error(err)
      }

      const attempted = Number(json?.sync?.attempted ?? 0)
      const inserted  = Number(json?.sync?.inserted  ?? 0)
      const syncErrors = Number(json?.sync?.errors ?? 0)

      const updated = Number(json?.promote?.updated ?? 0)
      const promoteErrors = Number(json?.promote?.errors ?? 0)

      setMsg(
        `Sync: intentados ${attempted}, insertados ${inserted}, errores ${syncErrors} · ` +
        `Promote: actualizados ${updated}, errores ${promoteErrors}`
      )

      await load()
    } catch (e: any) {
      setMsg(`Sync/Promote falló: ${e?.message || 'Error'}`)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-4">
      <header className="flex items-center justify-between mb-3">
        <h1 className="text-2xl font-semibold">Emails</h1>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') load() }}
            placeholder="Buscar por comercio o asunto…"
            className="px-3 py-2 rounded border text-sm"
            style={{ minWidth: 220 }}
          />
          <select
            className="px-2 py-2 rounded border text-sm"
            value={processedFilter}
            onChange={e => setProcessedFilter(e.target.value as any)}
            title="Filtrar por estado de procesamiento"
          >
            <option value="all">Todos</option>
            <option value="pending">Pendientes</option>
            <option value="done">Procesados</option>
          </select>
          <button
            onClick={trigger}
            disabled={syncing}
            className="px-3 py-2 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
            title="Leer últimos correos y promover a transacciones"
          >
            {syncing ? 'Procesando…' : 'Leer y promover'}
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-2 rounded bg-gray-200 text-sm"
            title="Actualizar lista"
          >
            {loading ? 'Cargando…' : 'Actualizar'}
          </button>
        </div>
      </header>

      {lastUpdated && (
        <div className="mb-2 text-xs text-gray-500">
          Última actualización: {lastUpdated.toLocaleTimeString('es-AR', { hour12: false })}
        </div>
      )}

      {msg && <div className="mb-3 text-sm text-gray-700">{msg}</div>}

      <div className="overflow-x-auto border rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left">Fecha</th>
              <th className="px-3 py-2 text-left">Comercio</th>
              <th className="px-3 py-2 text-right">Monto</th>
              <th className="px-3 py-2 text-center">Proc.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2 whitespace-nowrap">
                  {(r.date_local || r.email_datetime || '').slice(0,10)}
                </td>
                <td className="px-3 py-2">{prettifyMerchant(r.merchant)}</td>
                <td className="px-3 py-2 text-right">
                  {formatAmount(r.amount as any, r.currency)}
                </td>
                <td className="px-3 py-2 text-center">
                  {r.processed ? '✅' : '⏳'}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-500">Sin resultados</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}