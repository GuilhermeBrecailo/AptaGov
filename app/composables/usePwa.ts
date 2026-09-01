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
  const installed = useState('pwa-installed', getStandaloneState);
  const isMobile = useState('pwa-mobile', () => import.meta.client && isMobileUserAgent(navigator.userAgent));
  const isIos = useState('pwa-ios', () => import.meta.client && isIosUserAgent(navigator.userAgent));
  const requiresPwaForNotifications = computed(() => isMobile.value && !installed.value);
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

  function refreshInstallState(): void {
    installed.value = getStandaloneState();
    if (!import.meta.client) return;
    isMobile.value = isMobileUserAgent(navigator.userAgent);
    isIos.value = isIosUserAgent(navigator.userAgent);
    notificationPermission.value = getNotificationPermission();
  }

  async function refreshNotificationSubscription(): Promise<void> {
    if (!import.meta.client || !('serviceWorker' in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.ready;
      if (!registration.pushManager) return;
      notificationsEnabled.value = Boolean(await registration.pushManager.getSubscription());
    } catch {
      notificationsEnabled.value = false;
    }
  }

  async function enableNotifications(): Promise<boolean> {
    if (requiresPwaForNotifications.value) {
      notificationPermission.value = 'unsupported';
      notificationError.value = isIos.value
        ? 'No iPhone ou iPad, instale o AptaGov na Tela de Início e abra pelo ícone do aplicativo.'
        : 'Instale o AptaGov como aplicativo para ativar as notificações neste celular.';
      return false;
    }

    if (!import.meta.client || !('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      notificationPermission.value = 'unsupported';
      notificationError.value = 'Este dispositivo não oferece notificações Web Push. Instale o AptaGov como PWA ou use um navegador compatível.';
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
    isIos,
    requiresPwaForNotifications,
    install,
    refreshInstallState,
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

function isMobileUserAgent(userAgent: string): boolean {
  return /android|iphone|ipad|ipod|mobile/i.test(userAgent);
}

function isIosUserAgent(userAgent: string): boolean {
  return /iphone|ipad|ipod/i.test(userAgent);
}

function urlBase64ToUint8Array(value: string): Uint8Array {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(window.atob(base64), (character) => character.charCodeAt(0));
}
