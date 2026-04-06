import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Season, MoviePick, Profile } from '@/hooks/useGroup';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Play, Shuffle, ListOrdered, GripVertical, CalendarClock } from 'lucide-react';
import { toast } from 'sonner';
import { nextMonday, setHours, setMinutes, format, addDays } from 'date-fns';
import { useRef, useCallback } from 'react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  season: Season;
  moviePicks: MoviePick[];
  profiles: Profile[];
  onUpdate: () => void;
  labels: { Watching: string; item: string; Item: string; type: string };
  showCallDate: boolean;
}

export default function StartWatchingDialog({
  open, onOpenChange, season, moviePicks, profiles, onUpdate, labels, showCallDate,
}: Props) {
  const [orderMode, setOrderMode] = useState<'random' | 'manual'>('random');
  const [orderedPicks, setOrderedPicks] = useState<MoviePick[]>([]);
  const [callDate, setCallDate] = useState('');
  const [callTime, setCallTime] = useState('19:30');
  const [callTimezone, setCallTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [loading, setLoading] = useState(false);

  // Initialize ordered picks and default call date when dialog opens
  useEffect(() => {
    if (open) {
      const sorted = [...moviePicks].sort((a, b) => (a.watch_order ?? 0) - (b.watch_order ?? 0));
      setOrderedPicks(sorted);
      const nextMon = nextMonday(new Date());
      setCallDate(format(nextMon, 'yyyy-MM-dd'));
      setCallTime('19:30');
      setOrderMode('random');
    }
  }, [open, moviePicks]);

  const getProfileName = (userId: string) =>
    profiles.find(p => p.user_id === userId)?.display_name || 'Unknown';

  const moveItem = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= orderedPicks.length) return;
    const updated = [...orderedPicks];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);
    setOrderedPicks(updated);
  };

  const listRef = useRef<HTMLDivElement>(null);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      let picksToSave: MoviePick[];
      if (orderMode === 'random') {
        picksToSave = [...moviePicks].sort(() => Math.random() - 0.5);
      } else {
        picksToSave = orderedPicks;
      }

      // Save watch order
      for (let i = 0; i < picksToSave.length; i++) {
        const { error } = await supabase
          .from('movie_picks')
          .update({ watch_order: i })
          .eq('id', picksToSave[i].id);
        if (error) throw error;
      }

      // Build call date
      let callDateISO: string | null = null;
      if (callDate) {
        try {
          const dateStr = `${callDate}T${callTime || '19:30'}:00`;
          const d = new Date(dateStr);
          callDateISO = d.toISOString();
        } catch {
          const fallback = setMinutes(setHours(nextMonday(new Date()), 19), 30);
          callDateISO = fallback.toISOString();
        }
      }

      const { error } = await supabase.from('seasons').update({
        status: 'watching' as const,
        current_movie_index: 0,
        ...(callDateISO ? { next_call_date: callDateISO } : {}),
      }).eq('id', season.id);
      if (error) throw error;

      toast.success(`${labels.Watching} started!`);
      onOpenChange(false);
      onUpdate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to start watching');
    } finally {
      setLoading(false);
    }
  };

  const timezones = [
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu',
    'America/Toronto', 'America/Vancouver', 'America/Mexico_City',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
    'Europe/Rome', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Tokyo',
    'Australia/Sydney', 'Pacific/Auckland',
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Play className="w-4 h-4" /> Start {labels.Watching}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Order selection */}
          <div className="space-y-3">
            <p className="text-sm font-medium">{labels.Item} Order</p>
            <RadioGroup
              value={orderMode}
              onValueChange={(v) => setOrderMode(v as 'random' | 'manual')}
              className="grid grid-cols-2 gap-2"
            >
              <Label
                htmlFor="order-random"
                className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                  orderMode === 'random' ? 'border-primary bg-primary/5' : 'border-border'
                }`}
              >
                <RadioGroupItem value="random" id="order-random" />
                <Shuffle className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-sm">Random</span>
              </Label>
              <Label
                htmlFor="order-manual"
                className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                  orderMode === 'manual' ? 'border-primary bg-primary/5' : 'border-border'
                }`}
              >
                <RadioGroupItem value="manual" id="order-manual" />
                <ListOrdered className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-sm">Manual</span>
              </Label>
            </RadioGroup>

            {/* Manual reorder list */}
            {orderMode === 'manual' && (
              <div ref={listRef} className="space-y-1 max-h-48 overflow-y-auto rounded-lg border border-border p-2">
                {orderedPicks.map((pick, idx) => (
                  <div
                    key={pick.id}
                    className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${
                      dragIndex === idx ? 'bg-primary/10 scale-[1.02]' : 'bg-muted/30 hover:bg-muted/50'
                    }`}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', String(idx))}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const from = parseInt(e.dataTransfer.getData('text/plain'));
                      moveItem(from, idx);
                    }}
                    onTouchStart={(e) => handleTouchStart(idx, e)}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                  >
                    <GripVertical className="w-3 h-3 text-muted-foreground shrink-0 cursor-grab" />
                    <span className="font-medium text-muted-foreground w-5">{idx + 1}.</span>
                    {pick.poster_url && (
                      <img src={pick.poster_url} alt="" className="w-6 h-9 rounded object-cover shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{pick.title}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{getProfileName(pick.user_id)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Call date */}
          {showCallDate && (
            <div className="space-y-3">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <CalendarClock className="w-3.5 h-3.5 text-muted-foreground" />
                First Call Date
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Date</label>
                  <Input
                    type="date"
                    value={callDate}
                    onChange={(e) => setCallDate(e.target.value)}
                    className="bg-muted/50 text-sm"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Time</label>
                  <Input
                    type="time"
                    value={callTime}
                    onChange={(e) => setCallTime(e.target.value)}
                    className="bg-muted/50 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground mb-1 block">Timezone</label>
                <select
                  value={callTimezone}
                  onChange={(e) => setCallTimezone(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-muted/50 px-2 text-sm text-foreground"
                >
                  {timezones.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="mt-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button variant="gold" size="sm" onClick={handleConfirm} disabled={loading}>
            <Play className="w-4 h-4 mr-1" />
            {loading ? 'Starting...' : `Start ${labels.Watching}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
