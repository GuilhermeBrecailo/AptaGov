import { captureInstallPrompt } from '../composables/usePwa';

export default defineNuxtPlugin(() => {
  const pwa = usePwa();
  window.addEventListener('online', () => { pwa.isOnline.value = true; });
  window.addEventListener('offline', () => { pwa.isOnline.value = false; });
  window.addEventListener('appinstalled', () => { pwa.installed.value = true; pwa.canInstall.value = false; });
  window.addEventListener('pageshow', () => { pwa.refreshInstallState(); void pwa.refreshNotificationSubscription(); });
  pwa.refreshInstallState();
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    captureInstallPrompt(event);
    pwa.canInstall.value = true;
  });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js?v=4', { updateViaCache: 'none' }).then(() => pwa.refreshNotificationSubscription()).catch(() => undefined);
  }
});
