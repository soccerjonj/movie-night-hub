import { supabase } from '@/integrations/supabase/client';

/**
 * Ask the push-notify edge function to send whatever events the database has
 * queued (the seasons trigger creates them). Fire-and-forget: the cron backstop
 * sends anything this misses within 30 minutes.
 */
export function pokeNotifications(reason: string): void {
  supabase.functions.invoke('push-notify', { body: { reason } }).catch(() => { /* cron will catch it */ });
}
