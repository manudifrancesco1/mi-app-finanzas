/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';

const nextConfig = {
  output: 'export',                 // static export
  images: { unoptimized: true },    // needed for GH Pages
  ...(isProd ? { 
    basePath: '/mi-app-finanzas',
    assetPrefix: '/mi-app-finanzas/'
  } : {})
};

module.exports = nextConfig;