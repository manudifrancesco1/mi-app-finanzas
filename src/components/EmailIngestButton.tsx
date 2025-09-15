import { useState } from "react"

export default function EmailIngestButton({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    setLoading(true)

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

      console.info('[EmailIngestButton]', { sync: syncJson, promote: promoteJson })
    } catch (e: any) {
      console.error('[EmailIngestButton] error', e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 active:translate-y-px disabled:opacity-50"
    >
      {loading ? "Procesando..." : "Leer emails Visa"}
    </button>
  )
}