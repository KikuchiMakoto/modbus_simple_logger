import { useCallback, useEffect, useState } from 'react';
import {
  notificationPermission,
  notificationsEnabled,
  notificationsSupported,
  onNotificationsEnabledChange,
  requestNotificationPermission,
  setNotificationsEnabled,
  type NotificationPermissionState,
} from '../utils/notifications';

export type NotificationsState = {
  supported: boolean;
  /** 'default' = never asked, 'denied' = blocked in browser settings. */
  permission: NotificationPermissionState;
  enabled: boolean;
  /**
   * Turning it on asks for permission first and stays off if that is refused —
   * an "on" toggle that shows nothing is worse than an honest "off".
   */
  setEnabled: (next: boolean) => void;
};

/**
 * UI wrapper over utils/notifications. The gate itself lives in that module
 * (notify() is called from worker handlers with no React context); this only
 * mirrors it for the panel.
 */
export function useNotifications(): NotificationsState {
  const [enabled, setEnabledState] = useState(() => notificationsEnabled());
  const [permission, setPermission] = useState<NotificationPermissionState>(() =>
    notificationPermission(),
  );

  // Another part of the app (or a second panel instance) may flip the toggle.
  useEffect(() => onNotificationsEnabledChange(setEnabledState), []);

  // Ask once at startup, while the user is still at the machine. A measurement
  // is started and then left alone, so a permission dialog raised later — at
  // the moment a script fails — is a dialog nobody is there to answer.
  // Only asked while the toggle is on and the answer is still 'default':
  // switching notifications off is never overridden, and a browser-level block
  // is never re-prompted (it cannot be undone from script anyway).
  useEffect(() => {
    if (!notificationsSupported || !enabled) return;
    if (notificationPermission() !== 'default') return;
    void requestNotificationPermission().then((result) => {
      setPermission(result);
      // A refusal turns the toggle off so the panel shows the real state rather
      // than an "on" switch that can never fire.
      if (result !== 'granted') setNotificationsEnabled(false);
    });
  }, [enabled]);

  const setEnabled = useCallback((next: boolean) => {
    if (!next) {
      setNotificationsEnabled(false);
      return;
    }
    void requestNotificationPermission().then((result) => {
      setPermission(result);
      setNotificationsEnabled(result === 'granted');
    });
  }, []);

  return { supported: notificationsSupported, permission, enabled, setEnabled };
}
