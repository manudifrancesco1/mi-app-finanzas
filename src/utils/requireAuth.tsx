// src/utils/requireAuth.tsx
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
// IMPORT RELATIVO en lugar de alias @/
import { supabase } from '../lib/supabaseClient'

export default function requireAuth(Component: React.FC) {
  return function ProtectedComponent(props: any) {
    const router = useRouter()
    const [loading, setLoading] = useState(true)

    useEffect(() => {
      const checkSession = async () => {
        const {
          data: { session }
        } = await supabase.auth.getSession()
        if (!session) {
          router.replace('/login')
        } else {
          setLoading(false)
        }
      }
      checkSession()
    }, [router])

    if (loading) {
      return <div className="p-10 text-center">Cargando...</div>
    }

    return <Component {...props} />
  }
}
