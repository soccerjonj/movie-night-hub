import { GOOGLE_MAPS_API_KEY } from './apiKeys';

declare global {
  interface Window {
    google?: any;
  }
}

let loadingPromise: Promise<void> | null = null;

export const loadGoogleMaps = () => {
  if (window.google?.maps) return Promise.resolve();
  if (loadingPromise) return loadingPromise;
  if (!GOOGLE_MAPS_API_KEY) {
    return Promise.reject(new Error('Missing Google Maps API key'));
  }

  loadingPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&libraries=places`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Maps'));
    document.head.appendChild(script);
  });

  return loadingPromise;
};
