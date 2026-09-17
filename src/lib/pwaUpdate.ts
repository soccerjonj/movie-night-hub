import { registerSW } from 'virtual:pwa-register';
import { toast } from 'sonner';

/**
 * Keeps installed clients current. Without this, a home-screen PWA that is
 * never fully closed never navigates, so the browser never checks for a new
 * service worker and members can sit on a build that's days old — which
 * breaks as soon as the database changes underneath it.
 *
 * - Checks for updates when the app comes back to the foreground and every
 *   15 minutes while open.
 * - If a new build is waiting and the member hasn't touched anything since
 *   this page load, reload silently (they were just opening the app).
 * - Otherwise show a persistent "Update available" toast with a Reload
 *   action, so nobody loses a half-finished ranking or guess sheet.
 */
export function setupPwaUpdates() {
  if (!('serviceWorker' in navigator)) return;

  let interacted = false;
  const markInteracted = () => { interacted = true; };
  window.addEventListener('pointerdown', markInteracted, { passive: true });
  window.addEventListener('keydown', markInteracted, { passive: true });

  let promptShown = false;

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      const justOpened = performance.now() < 15_000 && !interacted;
      if (justOpened) {
        updateSW(true);
        return;
      }
      if (promptShown) return;
      promptShown = true;
      toast('A new version is ready', {
        description: 'Reload to get the latest changes.',
        duration: Infinity,
        action: { label: 'Reload', onClick: () => updateSW(true) },
      });
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => { registration.update().catch(() => { /* offline */ }); };
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      window.setInterval(check, 15 * 60 * 1000);
    },
  });
}
