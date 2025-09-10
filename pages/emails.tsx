import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '@/lib/supabaseClient'

type EmailRow = {
  id: number
  user_id: string
  date_local: string | null
  email_datetime: string | null
  subject: string | null
  merchant: string | null
  amount: number | null
  currency: string | null
  card_last4: string | null
  processed: boolean | null
  source: string | null
}

export default function EmailsPage() {
  const router = useRouter()
  const [rows, setRows] = useState<EmailRow[]>([])
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

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
    return () => sub.subscription.unsubscribe()
  }, [router])

  const load = async () => {
    setLoading(true)
    setMsg(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const uid = session?.user?.id
      if (!uid) return

      const { data, error } = await supabase
        .from('email_transactions')
        .select('id,user_id,date_local,email_datetime,subject,merchant,amount,currency,card_last4,processed,source')
        .eq('user_id', uid)
        .order('email_datetime', { ascending: false })
        .limit(100)

      if (error) throw error
      setRows(data || [])
      setLastUpdated(new Date())
    } catch (e: any) {
      setMsg(`Error cargando emails: ${e?.message || String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const trigger = async () => {
    setSyncing(true)
    setMsg(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const uid = session?.user?.id
      if (!uid) {
        throw new Error('No hay sesión activa')
      }
      const r = await fetch('/api/email/trigger', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user_id: uid, limit: 25, days: 7 }),
      })
      const data = await r.json().catch(() => ({} as any))
      if (!r.ok) throw new Error(data?.error || 'Error')
      const attempted = Number(data?.sync?.attempted ?? 0)
      const inserted  = Number(data?.sync?.inserted  ?? 0)
      const errors    = Number(data?.sync?.errors    ?? 0)
      setMsg(`Sync OK: intentados ${attempted}, insertados ${inserted}, errores ${errors}`)
      await load()
    } catch (e: any) {
      setMsg(`Sync falló: ${e?.message || 'Error'}`)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-4">
      <header className="flex items-center justify-between mb-3">
        <h1 className="text-2xl font-semibold">Emails</h1>
        <div className="flex gap-2">
          <button
            onClick={trigger}
            disabled={syncing}
            className="px-3 py-2 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
            title="Leer últimos correos y agregarlos a email_transactions"
          >
            {syncing ? 'Leyendo…' : 'Leer mails'}
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
              <th className="px-3 py-2 text-left">Asunto</th>
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
                <td className="px-3 py-2">{r.subject}</td>
                <td className="px-3 py-2">{r.merchant ?? '—'}</td>
                <td className="px-3 py-2 text-right">
                  {r.amount != null ? `$${r.amount.toLocaleString('es-AR', { minimumFractionDigits: 2 })} ${r.currency || ''}` : '—'}
                </td>
                <td className="px-3 py-2 text-center">
                  {r.processed ? '✅' : '⏳'}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">Sin resultados</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}