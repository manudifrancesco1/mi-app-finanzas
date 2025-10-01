// pages/api/email/trigger.ts
import type { NextApiRequest, NextApiResponse } from 'next'

type Json = Record<string, any>

export default async function handler(req: NextApiRequest, res: NextApiResponse<Json>) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  try {
    const secret = process.env.EMAIL_INGEST_SECRET
    if (!secret) {
      return res.status(500).json({ ok: false, error: 'Missing EMAIL_INGEST_SECRET' })
    }

    const { user_id, limit, days, debug } = (req.body ?? {}) as {
      user_id?: string
      limit?: number
      days?: number
      debug?: boolean
    }

    // Build origin of the current deployment (works on Vercel and local dev)
    const forwardedProto = (req.headers['x-forwarded-proto'] as string | undefined)
    const isVercel = Boolean(process.env.VERCEL)
    const proto = forwardedProto || (isVercel ? 'https' : 'http')
    const host = req.headers.host as string
    const origin = `${proto}://${host}`

    const result: Json = { ok: true }

    // 1) SYNC: call internal endpoint with secret
    const syncResp = await fetch(`${origin}/api/email/sync`, {
      method: 'POST',
      headers: {
        'x-email-secret': secret,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ user_id, limit, days, debug }),
    })
    const syncJson = await syncResp.json().catch(() => ({}))
    result.sync = { status: syncResp.status, ...syncJson }

    // 2) PROMOTE: process pending rows (processed=false, tx_id IS NULL)
    const promoteResp = await fetch(`${origin}/api/email/promote`, {
      method: 'POST',
      headers: {
        'x-email-secret': secret,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ user_id, limit, debug }),
    })
    const promoteJson = await promoteResp.json().catch(() => ({}))
    result.promote = { status: promoteResp.status, ...promoteJson }

    return res.status(200).json(result)
  } catch (e: any) {
    console.error('[email/trigger] error', e)
    return res.status(500).json({ ok: false, error: e?.message || 'trigger failed' })
  }
}