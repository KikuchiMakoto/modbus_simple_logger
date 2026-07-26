// Web Notifications: OS-level alerts for things the user must not miss while
// the window is behind something else.
//
// A logger runs for hours and nobody watches it for hours. The events worth
// interrupting for are the ones that end or endanger a run — a ScriptRunner
// error, a script starting or stopping — plus whatever the script itself
// declares important via set_notify(msg).
//
// Two gates, both of which must be open before anything is shown:
//   - the user's own toggle (persisted, ON unless it has been switched off);
//   - the browser permission, asked for once at startup (useNotifications) and
//     again from the toggle itself if it was refused. Asking at startup is the
//     deliberate choice: this app is opened to start a measurement that then
//     runs unattended for hours, so the alert has to be armed before the user
//     walks away — not the first time something has already gone wrong.
//
// Everything routed through here is also written to the ScriptRunner log, so a
// user with notifications off loses nothing but the interruption.
import { readJsonStorage, writeJsonStorage } from './cookies';

const STORAGE_KEY = 'notificationsEnabled';

/** Notification API present at all (absent on a plain-http LAN viewer page). */
export const notificationsSupported =
  typeof window !== 'undefined' && 'Notification' in window;

export type NotificationPermissionState = NotificationPermission | 'unsupported';

// Module-level rather than React state: notify() is called from a worker
// message handler and from the acquisition path, neither of which has a
// component to read a prop from. useNotifications() mirrors it for the UI.
let enabled = notificationsSupported && (readJsonStorage<boolean>(STORAGE_KEY) ?? true);

const listeners = new Set<(enabled: boolean) => void>();

export const notificationsEnabled = (): boolean => enabled;

export const setNotificationsEnabled = (next: boolean): void => {
  enabled = next && notificationsSupported;
  writeJsonStorage(STORAGE_KEY, enabled);
  for (const listener of listeners) listener(enabled);
};

/** Subscribe to toggle changes; returns the unsubscribe function. */
export const onNotificationsEnabledChange = (listener: (enabled: boolean) => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const notificationPermission = (): NotificationPermissionState =>
  notificationsSupported ? Notification.permission : 'unsupported';

export const requestNotificationPermission = async (): Promise<NotificationPermissionState> => {
  if (!notificationsSupported) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    // Safari's callback-only signature, and any user-agent that refuses to ask.
    return Notification.permission;
  }
};

export type NotifyOptions = {
  /**
   * Replacement key. Two notifications sharing a tag collapse into one, which
   * is what keeps a `while True:` loop calling set_notify() from burying the
   * desktop under a hundred toasts.
   */
  tag?: string;
  /** Stay on screen until dismissed. For failures only. */
  sticky?: boolean;
};

const show = async (title: string, body: string, options: NotifyOptions): Promise<void> => {
  const init: NotificationOptions = {
    body,
    tag: options.tag,
    requireInteraction: options.sticky ?? false,
  };
  // The PWA path: on Android, `new Notification()` throws (notifications must
  // come from a Service Worker registration), and where a registration exists
  // its notifications survive the page being closed. The launcher registers no
  // Service Worker at all (see main.tsx), so it always takes the constructor
  // below.
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.showNotification(title, init);
      return;
    }
  } catch {
    // Fall through to the constructor.
  }
  try {
    new Notification(title, init);
  } catch (err) {
    console.warn('Notification failed:', err);
  }
};

/**
 * Show a notification if the user has both enabled them and granted permission.
 * Never throws and never awaits at the call site: an alert is a side effect of
 * the thing that happened, not a step in it.
 */
export const notify = (title: string, body: string, options: NotifyOptions = {}): void => {
  if (!enabled || !notificationsSupported) return;
  if (Notification.permission !== 'granted') return;
  void show(title, body, options);
};

/** Tags used by the app, kept together so their collapse behaviour is visible. */
export const NOTIFY_TAG = {
  /** Run lifecycle: start / completed / stopped / error all replace each other. */
  scriptRun: 'msl-script-run',
  /** set_notify() from a script: a burst collapses into the newest message. */
  scriptMessage: 'msl-script-message',
} as const;
