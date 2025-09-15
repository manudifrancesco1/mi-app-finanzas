import { useEffect, useState } from "react"

type Props = { userId?: string }

export default function EmailIngestButton({ userId }: Props) {
  const [loading, setLoading] = useState(false)
  const [resolvedUserId, setResolvedUserId] = useState<string | null>(userId ?? null)

  // Intentar obtener userId desde Supabase si no vino por props
  useEffect(() => {
    if (userId) { setResolvedUserId(userId); return }

    let isMounted = true
    async function fetchSessionUser() {
      try {
        // Cargamos Supabase sólo si están las envs disponibles
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL
        const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        if (!url || !key) return
        const { createClient } = await import("@supabase/supabase-js")
        const supabase = createClient(url, key)
        const { data } = await supabase.auth.getSession()
        const uid = data?.session?.user?.id ?? null
        if (isMounted) setResolvedUserId(uid)
      } catch (err) {
        console.warn('[EmailIngestButton] No se pudo resolver el userId desde Supabase', err)
      }
    }
    fetchSessionUser()
    return () => { isMounted = false }
  }, [userId])

  async function handleClick() {
    if (!resolvedUserId) {
      console.warn('[EmailIngestButton] No hay userId (sin sesión).')
      return
    }

    setLoading(true)
    try {
      const secret = process.env.NEXT_PUBLIC_EMAIL_INGEST_SECRET || ''

      // 1) Sync
      const syncRes = await fetch("/api/email/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-email-secret": secret,
        },
        body: JSON.stringify({ user_id: resolvedUserId, limit: 200, days: 30 }),
      })
      if (!syncRes.ok) throw new Error(`sync failed: ${syncRes.status}`)
      const syncJson = await syncRes.json()

      // 2) Promote
      const promoteRes = await fetch("/api/email/promote", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-email-secret": secret,
        },
        body: JSON.stringify({ user_id: resolvedUserId, limit: 60 }),
      })
      if (!promoteRes.ok) throw new Error(`promote failed: ${promoteRes.status}`)
      const promoteJson = await promoteRes.json()

      console.info('[EmailIngestButton]', { sync: syncJson, promote: promoteJson })
    } catch (e: any) {
      console.error('[EmailIngestButton] error', e)
    } finally {
      setLoading(false)
    }
  }

  const disabled = loading || !resolvedUserId

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      title={!resolvedUserId ? 'Iniciá sesión para leer emails' : undefined}
      className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 active:translate-y-px disabled:opacity-50"
    >
      {loading ? "Procesando..." : "Leer emails Visa"}
    </button>
  )
}