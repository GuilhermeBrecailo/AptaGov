interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type NotificationPermissionState = NotificationPermission | 'unsupported' | 'error';

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;

export function captureInstallPrompt(event: Event): void {
  deferredInstallPrompt = event as BeforeInstallPromptEvent;
}

export function usePwa() {
  const isOnline = useState('pwa-online', () => import.meta.client ? navigator.onLine : true);
  const canInstall = useState('pwa-can-install', () => false);
  const installed = useState('pwa-installed', () => import.meta.client && (window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)));
  const notificationPermission = useState<NotificationPermissionState>('pwa-notification-permission', getNotificationPermission);
  const notificationsEnabled = useState('pwa-notifications-enabled', () => false);
  const notificationError = useState('pwa-notification-error', () => '');

  async function install(): Promise<void> {
    if (!deferredInstallPrompt) return;
    await deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    if (choice.outcome === 'accepted') installed.value = true;
    deferredInstallPrompt = null;
    canInstall.value = false;
  }

  async function refreshNotificationSubscription(): Promise<void> {
    if (!import.meta.client || !('serviceWorker' in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.ready;
      notificationsEnabled.value = Boolean(await registration.pushManager.getSubscription());
    } catch {
      notificationsEnabled.value = false;
    }
  }

  async function enableNotifications(): Promise<boolean> {
    if (!import.meta.client || !('Notification' in window) || !('serviceWorker' in navigator)) {
      notificationPermission.value = 'unsupported';
      notificationError.value = 'Este navegador não oferece notificações do dispositivo.';
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      notificationPermission.value = permission;
      if (permission !== 'granted') {
        notificationError.value = permission === 'denied' ? 'Notificações bloqueadas nas configurações do navegador.' : 'A permissão ainda não foi concedida.';
        return false;
      }

      const config = await $fetch<{ configured: boolean; publicKey: string }>('/api/push-config');
      if (!config.configured || !config.publicKey) {
        notificationPermission.value = 'error';
        notificationError.value = 'O canal ainda não foi configurado no servidor.';
        return false;
      }

      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.publicKey) as BufferSource,
      });
      await $fetch('/api/push-subscriptions', { method: 'POST', body: subscription.toJSON() });
      notificationsEnabled.value = true;
      notificationError.value = '';
      return true;
    } catch (error) {
      notificationError.value = error instanceof Error ? error.message : 'Não foi possível ativar as notificações.';
      return false;
    }
  }

  return {
    isOnline,
    canInstall,
    installed,
    install,
    notificationPermission,
    notificationsEnabled,
    notificationError,
    enableNotifications,
    refreshNotificationSubscription,
  };
}

function getNotificationPermission(): NotificationPermissionState {
  if (!import.meta.client || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

function urlBase64ToUint8Array(value: string): Uint8Array {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(window.atob(base64), (character) => character.charCodeAt(0));
}
