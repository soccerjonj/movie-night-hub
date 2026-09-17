import { supabase } from '@/integrations/supabase/client';

/**
 * Ask the push-notify edge function to send whatever events the database has
 * queued (the seasons trigger creates them). Fire-and-forget: the cron backstop
 * sends anything this misses within 30 minutes.
 */
// The dashboard assigned this name at deploy time; the source lives in supabase/functions/push-notify.
export const PUSH_FUNCTION_NAME = 'smooth-api';

export function pokeNotifications(reason: string): void {
  supabase.functions.invoke(PUSH_FUNCTION_NAME, { body: { reason } }).catch(() => { /* cron will catch it */ });
}
