/**
 * Production-only service-worker registration.
 *
 * The worker is emitted by the Vite build with this build's hashed asset names.
 * It never controls the dev server, so HMR is unaffected.
 */
let registration: ServiceWorkerRegistration | null = null;
let updateListener: (() => void) | null = null;

function markUpdateReady(): void {
  if (navigator.serviceWorker.controller) updateListener?.();
}

export function registerServiceWorker(onUpdate: () => void): () => void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return () => undefined;
  updateListener = onUpdate;

  const register = async () => {
    try {
      registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      if (registration.waiting) markUpdateReady();
      registration.addEventListener('updatefound', () => {
        const worker = registration?.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed') markUpdateReady();
        });
      });
    } catch {
      // A failed registration must never prevent the app from working online.
    }
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible') void registration?.update();
  };
  if (document.readyState === 'complete') void register();
  else window.addEventListener('load', register, { once: true });
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    updateListener = null;
  };
}

/** Ask the waiting worker to activate; the page reloads on controllerchange. */
export async function applyServiceWorkerUpdate(): Promise<void> {
  const current = registration ?? await navigator.serviceWorker.getRegistration();
  current?.waiting?.postMessage({ type: 'SKIP_WAITING' });
}
