// pages/api/email/promote/trigger.ts
import type { NextApiRequest, NextApiResponse } from 'next'

export default async function trigger(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }
  try {
    const baseUrl =
      process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'

    const r = await fetch(`${baseUrl}/api/email/promote?limit=${encodeURIComponent(String(req.query.limit ?? '50'))}`, {
      method: 'POST',
      headers: {
        'x-email-secret': process.env.EMAIL_INGEST_SECRET || '',
        'content-type': 'application/json',
      },
    })

    const json = await r.json().catch(() => ({}))
    return res.status(r.status).json(json)
  } catch (e: any) {
    console.error(e)
    return res.status(500).json({ ok: false, error: e.message })
  }
}