import { useEffect, useState } from 'react';
import { Bell, BellOff, Share, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { getPushStatus, subscribeToPush, unsubscribeFromPush, type PushStatus } from '@/lib/push';

const DISMISS_KEY = 'notifications_card_dismissed';

/**
 * Opt-in for push notifications. Hidden when unsupported or denied; on iOS in
 * the browser it explains that the app must be on the Home Screen first.
 */
const NotificationsCard = () => {
  const { user } = useAuth();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    let alive = true;
    getPushStatus().then((s) => { if (alive) setStatus(s); }).catch(() => { if (alive) setStatus('unsupported'); });
    return () => { alive = false; };
  }, []);

  if (!user || !status || status === 'unsupported' || status === 'denied') return null;
  if (status !== 'on' && dismissed) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
    setDismissed(true);
  };

  const turnOn = async () => {
    setBusy(true);
    try {
      const next = await subscribeToPush(user.id);
      setStatus(next);
      if (next === 'on') toast.success('Notifications on');
      else if (next === 'denied') toast.error('Notifications are blocked for this site in your browser settings.');
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || "Couldn't turn on notifications");
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    try {
      await unsubscribeFromPush();
      setStatus('off');
      toast.success('Notifications off');
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || "Couldn't turn off notifications");
    } finally {
      setBusy(false);
    }
  };

  if (status === 'on') {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/15 border border-border/30 px-3 py-2 mb-4">
        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Bell className="w-3.5 h-3.5 text-primary" /> Notifications on
        </span>
        <button onClick={turnOff} disabled={busy} className="text-[11px] text-muted-foreground hover:text-primary transition-colors inline-flex items-center gap-1">
          <BellOff className="w-3 h-3" /> Turn off
        </button>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl ring-1 ring-white/5 bg-gradient-to-br from-card via-card to-muted/20 p-4 mb-4">
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_80%_10%,hsl(38_90%_55%/0.12),transparent_55%)]" />
      <button onClick={dismiss} aria-label="Dismiss" className="absolute top-2.5 right-2.5 z-10 w-6 h-6 rounded-full flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-white/5">
        <X className="w-3.5 h-3.5" />
      </button>
      <div className="relative z-10 flex items-start gap-3">
        <span className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
          <Bell className="w-4 h-4 text-primary" />
        </span>
        <div className="flex-1 min-w-0 pr-6">
          <p className="text-sm font-semibold">Get a heads-up</p>
          {status === 'needs-install' ? (
            <p className="text-xs text-muted-foreground mt-0.5">
              Notifications work once the app is on your Home Screen: tap <Share className="inline w-3 h-3 -mt-0.5" /> in Safari, then <span className="text-foreground">Add to Home Screen</span>, and open it from there.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground mt-0.5">
                When picking opens, guessing starts, a new film is up, or a call is an hour away.
              </p>
              <button
                onClick={turnOn}
                disabled={busy}
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-primary to-amber-300 text-black font-semibold text-xs px-3.5 py-1.5 shadow-[0_6px_20px_-6px_hsl(38_90%_55%/0.5)] hover:brightness-105 active:scale-[0.98] transition disabled:opacity-60"
              >
                <Bell className="w-3.5 h-3.5" /> Turn on notifications
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default NotificationsCard;
