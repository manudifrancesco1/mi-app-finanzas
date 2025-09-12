// components/EmailIngestButton.tsx
import { useState } from "react"

export default function EmailIngestButton({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)

  async function handleClick() {
    setLoading(true)
    setResult(null)

    try {
      // 1) Sync
      const syncRes = await fetch("/api/email/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-email-secret": process.env.NEXT_PUBLIC_EMAIL_INGEST_SECRET!,
        },
        body: JSON.stringify({ user_id: userId, limit: 200, days: 30 }),
      })
      const syncJson = await syncRes.json()

      // 2) Promote
      const promoteRes = await fetch("/api/email/promote", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-email-secret": process.env.NEXT_PUBLIC_EMAIL_INGEST_SECRET!,
        },
        body: JSON.stringify({ user_id: userId, limit: 60 }),
      })
      const promoteJson = await promoteRes.json()

      setResult({ sync: syncJson, promote: promoteJson })
    } catch (e: any) {
      setResult({ error: e.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={loading}
        className="px-4 py-2 bg-green-600 text-white rounded"
      >
        {loading ? "Procesando..." : "Leer emails Visa"}
      </button>
      {result && (
        <pre className="mt-2 p-2 bg-gray-100 text-xs overflow-x-auto">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  )
}