// pages/api/email/promote/trigger.ts
import type { NextApiRequest, NextApiResponse } from 'next'

export default async function trigger(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  try {
    const limit = Number(req.query.limit ?? 50) || 50
    const secret = process.env.EMAIL_INGEST_SECRET
    if (!secret) return res.status(500).json({ ok: false, error: 'Missing EMAIL_INGEST_SECRET' })

    // URL interna del deployment actual
    const base =
      process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : `http://localhost:${process.env.PORT || 3000}`

    const r = await fetch(`${base}/api/email/promote?limit=${limit}`, {
      method: 'POST',
      headers: {
        'x-email-secret': secret,
        'content-type': 'application/json',
      },
    })

    const data = await r.json().catch(() => ({}))
    return res.status(r.status).json(data)
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Unknown error' })
  }
}