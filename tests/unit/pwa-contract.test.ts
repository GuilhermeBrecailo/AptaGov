import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('contrato do PWA', () => {
  it('declara instalação standalone e fallback offline', () => {
    const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as {
      name: string;
      short_name: string;
      display: string;
      start_url: string;
      icons: Array<{ src: string; sizes: string }>;
    };
    const serviceWorker = readFileSync('public/sw.js', 'utf8');
    const plugin = readFileSync('app/plugins/pwa.client.ts', 'utf8');
    const home = readFileSync('app/pages/index.vue', 'utf8');

    expect(manifest.display).toBe('standalone');
    expect(manifest.name).toBe('AptaGov — Licitações');
    expect(manifest.short_name).toBe('AptaGov');
    expect(manifest.start_url).toBe('/');
    expect(manifest.icons.some((icon) => icon.sizes === '192x192')).toBe(true);
    expect(manifest.icons.some((icon) => icon.sizes === '512x512')).toBe(true);
    expect(serviceWorker).toContain('/offline.html');
    expect(serviceWorker).toContain('/api/');
    expect(plugin).toContain('beforeinstallprompt');
    expect(plugin).toContain("register('/sw.js?v=4',");
    expect(home).toContain('Instalar aplicativo');
    expect(home).toContain('Sem conexão');
  });

  it('declara ativação de notificações push no dispositivo', () => {
    const composable = readFileSync('app/composables/usePwa.ts', 'utf8');
    const serviceWorker = readFileSync('public/sw.js', 'utf8');
    const home = readFileSync('app/pages/index.vue', 'utf8');
    const configuration = readFileSync('app/pages/configuracao.vue', 'utf8');
    const pushApi = readFileSync('server/api/push-subscriptions.post.ts', 'utf8');
    const migration = readFileSync('migrations/004_push_notifications.sql', 'utf8');

    expect(composable).toContain('Notification.requestPermission');
    expect(composable).toContain('pushManager.subscribe');
    expect(composable).toContain('requiresPwaForNotifications');
    expect(composable).toContain('notificationPermission.value = getNotificationPermission();');
    expect(composable).toContain('function getStandaloneState()');
    expect(serviceWorker).toContain('showNotification');
    expect(serviceWorker).toContain('notificationclick');
    expect(home).not.toContain('Ativar notificações no dispositivo');
    expect(configuration).toContain('Ativar notificações');
    expect(configuration).toContain('use o AptaGov instalado');
    expect(configuration).toContain('Já instalei');
    expect(pushApi).toContain("requireActiveBilling(event, 'notifications')");
    expect(migration).toContain('UNIQUE (endpoint)');
  });

  it('nÃ£o cacheia mÃ³dulos do Nuxt/Vite em desenvolvimento', () => {
    const serviceWorker = readFileSync('public/sw.js', 'utf8');

    expect(serviceWorker).toContain("const CACHE_NAME = 'aptagov-shell-v4';");
    expect(serviceWorker).toContain("url.pathname.startsWith('/_nuxt/@')");
    expect(serviceWorker).toContain("url.pathname === '/_nuxt/assets/css/main.css'");
  });
});
