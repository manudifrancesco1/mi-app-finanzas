/ ** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production'
const isVercel = Boolean(process.env.VERCEL) // true on Vercel builds

// En Vercel: nunca usar export, porque rompe API routes
// En prod fuera de Vercel (ej. GitHub Pages): usar export
const nextConfig = (isProd && !isVercel)
  ? {
      output: 'export',
      images: { unoptimized: true },
      basePath: '/mi-app-finanzas',
      assetPrefix: '/mi-app-finanzas/',
    }
  : {
      reactStrictMode: true,
      swcMinify: true,
    }

module.exports = nextConfig