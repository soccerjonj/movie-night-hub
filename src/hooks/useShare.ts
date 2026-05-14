import { useState } from 'react';
import { toast } from 'sonner';

export interface SharePayload {
  title: string;
  text?: string;
  url?: string;
  image?: Blob;
}

/**
 * Reusable share hook. Uses the native Web Share API when available
 * (iOS Safari, Android Chrome), falls back to clipboard otherwise.
 *
 * Image shares are attempted via navigator.share({ files }), which is
 * supported on modern iOS and Android. If unsupported, falls through
 * to text/url share or clipboard.
 */
export function useShare() {
  const [sharing, setSharing] = useState(false);

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const share = async (payload: SharePayload) => {
    if (sharing) return;
    setSharing(true);
    try {
      const { title, text, url, image } = payload;

      // Try image share first if provided
      if (image && typeof navigator !== 'undefined' && typeof navigator.canShare === 'function') {
        const file = new File([image], 'share.png', { type: image.type || 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ title, text, files: [file] });
          return;
        }
      }

      // Native share with text/url
      if (canShare) {
        await navigator.share({ title, text, url });
        return;
      }

      // Clipboard fallback
      if (url || text) {
        await navigator.clipboard.writeText(url || text || '');
        toast.success('Link copied to clipboard');
      }
    } catch (err: unknown) {
      // AbortError = user cancelled the share sheet — silent
      if (err instanceof Error && err.name !== 'AbortError') {
        toast.error('Could not share. Try copying the link instead.');
      }
    } finally {
      setSharing(false);
    }
  };

  return { canShare, share, sharing };
}
