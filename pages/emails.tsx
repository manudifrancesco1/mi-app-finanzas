import type { NextApiRequest, NextApiResponse } from 'next'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }
  return res.status(200).json({ ok: true, test: 'promote-alive' })
}

import { useState } from 'react'

export default function EmailsPage() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const handleReadEmails = async () => {
    try {
      setLoading(true)
      setResult(null)
      const res = await fetch('/api/email/promote/trigger', { method: 'POST' })
      const data = await res.json()
      setResult(JSON.stringify(data, null, 2))
    } catch (e: any) {
      setResult(`Error: ${e?.message || 'unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-4">
      <h1 className="text-xl font-semibold mb-4">Emails</h1>
      <button
        onClick={handleReadEmails}
        className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
        disabled={loading}
      >
        {loading ? 'Leyendo…' : 'Leer emails'}
      </button>

      {result && (
        <pre className="mt-4 p-3 bg-gray-100 rounded text-sm overflow-auto">
          {result}
        </pre>
      )}
    </div>
  )
}