// pages/api/email/promote/index.ts
import type { NextApiRequest, NextApiResponse } from 'next'

const EMAIL_INGEST_SECRET = process.env.EMAIL_INGEST_SECRET!

/**
 * Trigger endpoint (/api/email/promote, POST) that performs BOTH steps:
 * 1) /api/email/ingest  -> lee emails nuevos y los guarda en email_transactions
 * 2) /api/email/promote -> mueve los pendientes a transactions (upsert por hash)
 *
 * Esto permite que el botón "Leer emails" funcione de punta a punta en un solo click,
 * incluso si antes vaciaste la tabla email_transactions.
 */
export default async function trigger(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  try {
    const qs = req.url?.includes('?') ? `?${req.url.split('?')[1]}` : ''
    const proto = (req.headers['x-forwarded-proto'] as string) || 'https'
    const host = req.headers.host as string
    const base = `${proto}://${host}`

    // Compartimos el mismo secreto para ambas llamadas internas
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-email-secret': EMAIL_INGEST_SECRET,
    }

    // 1) Ingest: trae emails nuevos -> email_transactions
    const ingestResp = await fetch(`${base}/api/email/ingest${qs}`, {
      method: 'POST',
      headers,
    })
    const ingestJson = await safeJson(ingestResp)

    // 2) Promote: mueve pendientes -> transactions
    const promoteResp = await fetch(`${base}/api/email/promote${qs}`, {
      method: 'POST',
      headers,
    })
    const promoteJson = await safeJson(promoteResp)

    return res.status(200).json({
      ok: true,
      step: 'ingest+promote',
      ingest: sanitize(ingestJson),
      promote: sanitize(promoteJson),
    })
  } catch (e: any) {
    console.error('trigger error', e)
    return res.status(500).json({ ok: false, error: e?.message || 'Internal error' })
  }
}

async function safeJson(resp: Response) {
  try {
    return await resp.json()
  } catch {
    return { ok: false, status: resp.status, text: await resp.text() }
  }
}

function sanitize(obj: any) {
  // Evita retornar datos enormes; dejar resumen útil
  if (!obj || typeof obj !== 'object') return obj
  const out: any = { ...obj }
  if (Array.isArray(out.inserted)) out.inserted = `[${out.inserted.length} items]`
  if (Array.isArray(out.errors)) out.errors = out.errors.slice(0, 3) // primeras 3
  if (Array.isArray(out.pending)) out.pending = `[${out.pending.length} items]`
  return out
}