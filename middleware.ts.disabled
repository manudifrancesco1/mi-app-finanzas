// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1) Permitir el acceso a /login, a los assets y a la API de auth
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/auth')
  ) {
    return NextResponse.next();
  }

  // 2) Revisar cookie de Supabase (sb-access-token)
  const token = req.cookies.get('sb-access-token')?.value;

  // 3) Si no hay token, redirigir a login
  if (!token) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = '/login';
    return NextResponse.redirect(loginUrl);
  }

  // 4) Si hay token, dejar pasar
  return NextResponse.next();
}

// Aplicar middleware a todas las rutas salvo las excepciones
export const config = {
  matcher: ['/', '/((?!_next|api|static|favicon.ico).*)'],
};
