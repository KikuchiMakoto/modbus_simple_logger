// Service Worker registration and the consent-gated update flow (PWA only).
//
// Update prompts are deliberately restricted to *explicit* checks: the one run
// right after startup and the "Check for Updates" button in App Info. A new
// version found by the periodic background check installs silently and parks in
// `waiting` — it never interrupts a running measurement with a confirm dialog.
// The next explicit check picks that waiting worker up and prompts for it.
//
// While a device is connected no check runs at all (see
// setUpdateChecksSuspended): the only thing an update can offer mid-session is
// a reload that would drop the serial connection and stop the measurement.

export type UpdateCheckResult =
  /** No Service Worker in this context (launcher mode, unsupported browser, registration failed). */
  | 'unsupported'
  /** Checks are paused because a device is connected. */
  | 'suspended'
  /** A ready new version was found; the confirm prompt is up. */
  | 'prompted'
  /** A new version is being downloaded; the prompt follows once it is installed. */
  | 'downloading'
  /** Already running the newest version. */
  | 'up-to-date'
  /** The check itself failed (offline, server error). */
  | 'failed';

// Launcher (desktop exe) mode is detected purely by hostname: the launcher
// serves the app from 127.0.0.1 only. Regular deployments never use that host
// — GitHub Pages is a public domain and `vite preview` serves on `localhost` —
// so this leaves Pages and PWA behaviour completely unchanged.
const isLauncherMode = window.location.hostname === '127.0.0.1';

const swAvailable = !isLauncherMode && 'serviceWorker' in navigator;

/** Whether an update check can run at all (false in launcher mode / no SW support). */
export const isUpdateCheckSupported = () => swAvailable;

// Set from App while a device is connected. Both the explicit checks and the
// periodic background one stand down: applying an update means reloading, which
// would drop the port mid-measurement, so there is nothing useful to find out.
let checksSuspended = false;

/** Pause every update check (App calls this with the device connection state). */
export function setUpdateChecksSuspended(suspended: boolean) {
  checksSuspended = suspended;
}

const currentVersion: string | undefined = import.meta.env.VITE_APP_VERSION;

let registrationPromise: Promise<ServiceWorkerRegistration> | null = null;

// Ask a (waiting) Service Worker which app version it was built from.
// sw.js answers GET_VERSION on the transferred MessageChannel port; SWs
// built before that handler existed never reply, so time out and fall
// back to a version-less prompt rather than hanging.
const queryWorkerVersion = (worker: ServiceWorker): Promise<string | null> =>
  new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), 500);
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => {
      window.clearTimeout(timer);
      resolve(typeof event.data?.appVersion === 'string' ? event.data.appVersion : null);
    };
    worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
  });

// Every version switch requires explicit user consent. sw.js deliberately
// does NOT call skipWaiting() during install, so a new version parks in
// `waiting` while the current version keeps serving with its cache intact;
// activation (old cache deleted + clients claimed) only happens once we post
// SKIP_WAITING here. Declining leaves the worker waiting: this session keeps
// running the current version in full, and the prompt reappears on the next
// launch or on the next press of the App Info "Check for Updates" button.
const promptAndActivate = async (worker: ServiceWorker) => {
  const newVersion = await queryWorkerVersion(worker);
  const versionInfo = newVersion && currentVersion ? ` (v${currentVersion} → v${newVersion})` : '';
  const shouldActivate = window.confirm(
    `A new version of the app is available${versionInfo}. Update and reload now?\n\n` +
    'Warning: Reloading will stop any active measurement.'
  );
  if (shouldActivate) {
    worker.postMessage({ type: 'SKIP_WAITING' });
  }
};

// One prompt at a time: the waiting branch and an `installed` statechange can
// otherwise stack two confirms for the same update. A declined prompt clears
// the flag, so a later explicit check asks again about the same worker.
let promptInFlight = false;
const promptOnce = (worker: ServiceWorker) => {
  if (promptInFlight) return;
  promptInFlight = true;
  void promptAndActivate(worker).finally(() => {
    promptInFlight = false;
  });
};

// Prompt as soon as `worker` is installed (i.e. fully precached and safe to
// activate). Only relevant when this page is SW-controlled — with no
// controller the worker activates on its own (first-install path, nothing to
// lose) and there is nothing to consent to.
const promptWhenInstalled = (worker: ServiceWorker) => {
  if (!navigator.serviceWorker.controller) return;
  if (worker.state === 'installed') {
    promptOnce(worker);
    return;
  }
  worker.addEventListener('statechange', () => {
    if (worker.state !== 'installed' || !navigator.serviceWorker.controller) return;
    promptOnce(worker);
  });
};

// Open only while an *explicit* check (startup / App Info button) is running
// its `registration.update()`. `updatefound` fires synchronously inside that
// call, so a worker discovered by the silent periodic check — or by the
// browser's own update check — is installed without ever being adopted for a
// prompt.
let explicitCheckRunning = false;

const attachUpdateFound = (registration: ServiceWorkerRegistration) => {
  registration.addEventListener('updatefound', () => {
    const newWorker = registration.installing;
    if (!newWorker || !explicitCheckRunning) return;
    promptWhenInstalled(newWorker);
  });
};

const runUpdateCheck = async (): Promise<UpdateCheckResult> => {
  if (!registrationPromise) return 'unsupported';

  let registration: ServiceWorkerRegistration;
  try {
    registration = await registrationPromise;
  } catch {
    return 'unsupported';
  }

  // A new version left waiting by an earlier check (declined prompt, or the
  // silent periodic check): ask about it now, no network round trip needed.
  if (registration.waiting && navigator.serviceWorker.controller) {
    promptOnce(registration.waiting);
    return 'prompted';
  }

  // An install already in flight (started by the periodic check): adopt it so
  // its completion prompts instead of parking silently.
  if (registration.installing) {
    promptWhenInstalled(registration.installing);
    return 'downloading';
  }

  explicitCheckRunning = true;
  try {
    await registration.update();
  } catch (error) {
    console.warn('SW update check failed:', error);
    return 'failed';
  } finally {
    explicitCheckRunning = false;
  }

  // Adopt whatever this check surfaced. `updatefound` normally fires (and
  // adopts) inside update() above, but a worker discovered by the browser's own
  // update job — one running concurrently with ours — can land here instead;
  // promptOnce keeps a single confirm either way.
  if (registration.installing) {
    promptWhenInstalled(registration.installing);
    return 'downloading';
  }
  if (registration.waiting && navigator.serviceWorker.controller) {
    promptOnce(registration.waiting);
    return 'prompted';
  }
  return 'up-to-date';
};

let checkInFlight: Promise<UpdateCheckResult> | null = null;

/**
 * Run the startup update check on demand (App Info "Check for Updates"):
 * identical flow, identical consent prompt. Concurrent calls share one check.
 */
export function checkForAppUpdate(): Promise<UpdateCheckResult> {
  if (!swAvailable) return Promise.resolve('unsupported');
  if (checksSuspended) return Promise.resolve('suspended');
  if (!checkInFlight) {
    const check = runUpdateCheck();
    checkInFlight = check;
    void check.finally(() => {
      if (checkInFlight === check) checkInFlight = null;
    });
  }
  return checkInFlight;
}

/**
 * Register the Service Worker and run the startup update check.
 *
 * In launcher mode the server itself sends COOP/COEP on every response and
 * disables caching (Cache-Control: no-store), so the Service Worker is neither
 * needed nor wanted: registering it would reintroduce an HTTP-cache-independent
 * cache layer that could serve stale assets after an exe update. We also
 * proactively unregister any SW left behind by a previous PWA visit to the same
 * origin (e.g. a developer who ran `vite preview` on 127.0.0.1 earlier), so no
 * residual precache survives into launcher mode.
 */
export function setupServiceWorker() {
  if (isLauncherMode) {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => {
          for (const registration of registrations) {
            registration.unregister();
          }
        })
        .catch((error) => {
          console.warn('SW unregister failed:', error);
        });
    }
    return;
  }

  if (!swAvailable) return;

  // Resolved by the `load` handler below; the App Info button awaits it, so a
  // press before registration finishes simply waits instead of failing.
  let settleRegistration!: (registration: ServiceWorkerRegistration) => void;
  let failRegistration!: (error: unknown) => void;
  registrationPromise = new Promise<ServiceWorkerRegistration>((resolve, reject) => {
    settleRegistration = resolve;
    failRegistration = reject;
  });
  // Nothing may be awaiting it at rejection time.
  registrationPromise.catch(() => {});

  window.addEventListener('load', () => {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker
      .register(swUrl)
      .then((registration) => {
        console.log('SW registered:', registration);
        attachUpdateFound(registration);
        settleRegistration(registration);

        // The startup check — the only automatic prompt path.
        void checkForAppUpdate();

        // Periodically check for SW updates (every 60 seconds). Silent by
        // design: anything found here installs and parks in `waiting` so the
        // next explicit check can offer it without a download wait. Skipped
        // entirely while a device is connected — no downloads competing with a
        // running measurement.
        const updateInterval = window.setInterval(() => {
          if (checksSuspended) return;
          registration.update().catch((err) => {
            console.warn('SW update check failed:', err);
          });
        }, 60_000);

        // Cleanup interval on pagehide
        window.addEventListener('pagehide', () => {
          window.clearInterval(updateInterval);
        }, { once: true });
      })
      .catch((error) => {
        console.log('SW registration failed:', error);
        failRegistration(error);
      });
  });

  // Reload the page when a new SW takes over. Activation is consent-gated
  // above (or happens on the very first install, where nothing can be
  // interrupted), so by the time controllerchange fires the reload has
  // already been approved — never prompt here: the old cache is gone at
  // this point, and declining would leave the page running a half-broken
  // version.
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}
