/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production'
const isVercel = Boolean(process.env.VERCEL) // true on Vercel builds

// En Vercel y en dev local: NO static export → API habilitadas
// Solo fuera de Vercel + prod: export estático (p/ GitHub Pages)
const nextConfig = (!isVercel && isProd)
  ? {
      output: 'export',
      images: { unoptimized: true },
      basePath: '/mi-app-finanzas',
      assetPrefix: '/mi-app-finanzas/',
    }
  : {
      reactStrictMode: true,
    }

module.exports = nextConfig