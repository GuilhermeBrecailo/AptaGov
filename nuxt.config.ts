export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: false },
  app: {
    head: {
      link: [
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'icon', href: '/icons/icon.svg', type: 'image/svg+xml' },
        { rel: 'apple-touch-icon', href: '/icons/icon.svg' },
      ],
      meta: [
        { name: 'theme-color', content: '#14213d' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
      ],
    },
  },
  css: ['~/assets/css/main.css'],
  typescript: {
    strict: true,
    typeCheck: false,
  },
  runtimeConfig: {
    public: {
      appName: 'AptaGov',
    },
  },
});
