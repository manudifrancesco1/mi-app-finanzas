/ ** @type {import('next').NextConfig} * /
const isProd = process.env.NODE_ENV === 'production';
const isVercel = Boolean(process.env.VERCEL); // true on Vercel builds

// On Vercel -> NO static export (API routes must work)
// Else (local/GitHub Pages) -> keep static export settings
const nextConfig = isVercel
  ? {
      reactStrictMode: true,
    }
  : {
      output: 'export',                // static export for GH Pages
      images: { unoptimized: true },   // needed for GH Pages
      ...(isProd
        ? {
            basePath: '/mi-app-finanzas',
            assetPrefix: '/mi-app-finanzas/',
          }
        : {}),
    };

module.exports = nextConfig;