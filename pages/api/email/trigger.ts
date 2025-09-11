// pages/api/email/trigger.ts
import type { NextApiRequest, NextApiResponse } from 'next'

const TIMEOUT_MS = Number(process.env.EMAIL_TRIGGER_TIMEOUT_MS || 25000)

function withTimeout<T>(p: Promise<T>, ms: number = TIMEOUT_MS, label = 'operation'): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }).catch((e) => { clearTimeout(t); reject(e) })
  })
}

/**
 * Trigger unificado SIN exponer secretos al cliente:
 * 1) Llama a /api/email/sync (lee IMAP y guarda en email_transactions)
 * 2) Llama a /api/email/promote (sube pendientes a transactions)
 *
 * Body opcional:
 * {
 *   user_id?: string
 *   days?: number
 *   limit?: number
 *   from?: string
 *   debug?: boolean
 * }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method not allowed' })

  const secret = process.env.EMAIL_INGEST_SECRET
  if (!secret) return res.status(500).json({ ok: false, error: 'Missing EMAIL_INGEST_SECRET' })

  const {
    user_id = process.env.DEFAULT_USER_ID,
    days = 14,
    limit = 50,
    from = process.env.EMAIL_SYNC_FROM || '',
    debug = false,
  } = (req.body ?? {}) as { user_id?: string; days?: number; limit?: number; from?: string; debug?: boolean }

  if (!user_id) return res.status(400).json({ ok: false, error: 'missing user_id (or set DEFAULT_USER_ID)' })

  // Origin del mismo deploy (soporta Vercel/localhost)
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https'
  const host = req.headers.host
  const origin = `${proto}://${host}`

  const out: any = { ok: true }

  try {
    // 1) SYNC con timeout
    const syncReq = fetch(`${origin}/api/email/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-email-secret': secret },
      body: JSON.stringify({ user_id, days, limit, from, debug }),
    })

    const syncResp = await withTimeout(syncReq, TIMEOUT_MS, 'sync')
      .then(r => r as Response)
      .catch((e) => {
        out.sync = { status: 504, ok: false, error: String(e?.message || e) }
        // devolvemos acá sin intentar promote
        return null
      })

    if (!syncResp) return res.status(504).json(out)

    const syncJson = await syncResp.json().catch(() => ({}))
    out.sync = { status: syncResp.status, ...syncJson }
    if (!syncResp.ok) return res.status(syncResp.status).json({ ok: false, ...out })

    // 2) PROMOTE con timeout (más corto)
    const promoteReq = fetch(`${origin}/api/email/promote?limit=${encodeURIComponent(String(limit))}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-email-secret': secret },
    })

    const promoteResp = await withTimeout(promoteReq, TIMEOUT_MS, 'promote')
      .then(r => r as Response)
      .catch((e) => {
        out.promote = { status: 504, ok: false, error: String(e?.message || e) }
        return null
      })

    if (!promoteResp) return res.status(504).json(out)

    const promoteJson = await promoteResp.json().catch(() => ({}))
    out.promote = { status: promoteResp.status, ...promoteJson }

    return res.status(200).json(out)
  } catch (e: any) {
    console.error('[email/trigger] fatal', e)
    out.error = e?.message || String(e)
    return res.status(500).json(out)
  }
}