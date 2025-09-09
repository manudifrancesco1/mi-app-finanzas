/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production'
const isVercel = Boolean(process.env.VERCEL) // true on Vercel builds

// Behaviour:
// - Vercel (any env) & local dev: SSR on, API routes enabled
// - Non‑Vercel production (e.g., GitHub Pages): static export with basePath/assetPrefix
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