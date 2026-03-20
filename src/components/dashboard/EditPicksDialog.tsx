import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Group, Profile } from '@/hooks/useGroup';
import { getClubLabels } from '@/lib/clubTypes';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { FilePenLine, Save, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  group: Group;
  profiles: Profile[];
  onUpdated: () => void;
}

interface SeasonOption {
  id: string;
  season_number: number;
  title: string | null;
}

interface PickRow {
  id: string;
  title: string;
  user_id: string;
  watch_order: number | null;
}

// A "movie slot" groups picks by watch_order (co-picks share the same watch_order)
interface MovieSlot {
  watchOrder: number | null;
  title: string;
  pickIds: string[]; // existing pick row ids
  originalUserIds: string[];
  currentUserIds: string[];
}

const EditPicksDialog = ({ group, profiles, onUpdated }: Props) => {
  const labels = getClubLabels(group.club_type);
  const [open, setOpen] = useState(false);
  const [seasons, setSeasons] = useState<SeasonOption[]>([]);
  const [selectedSeason, setSelectedSeason] = useState('');
  const [slots, setSlots] = useState<MovieSlot[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    supabase
      .from('seasons')
      .select('id, season_number, title')
      .eq('group_id', group.id)
      .order('season_number', { ascending: true })
      .then(({ data }) => setSeasons(data || []));
  }, [open, group.id]);

  useEffect(() => {
    if (!selectedSeason) { setSlots([]); return; }
    supabase
      .from('movie_picks')
      .select('id, title, user_id, watch_order')
      .eq('season_id', selectedSeason)
      .order('watch_order', { ascending: true })
      .then(({ data }) => {
        const picks = (data || []) as PickRow[];
        // Group by watch_order
        const grouped = new Map<number | string, PickRow[]>();
        picks.forEach(p => {
          const key = p.watch_order ?? p.id;
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key)!.push(p);
        });
        const movieSlots: MovieSlot[] = Array.from(grouped.entries())
          .sort(([a], [b]) => (typeof a === 'number' ? a : 999) - (typeof b === 'number' ? b : 999))
          .map(([, picks]) => ({
            watchOrder: picks[0].watch_order,
            title: picks[0].title,
            pickIds: picks.map(p => p.id),
            originalUserIds: picks.map(p => p.user_id),
            currentUserIds: picks.map(p => p.user_id),
          }));
        setSlots(movieSlots);
      });
  }, [selectedSeason]);

  const togglePicker = (slotIndex: number, userId: string) => {
    setSlots(prev => {
      const updated = [...prev];
      const slot = { ...updated[slotIndex] };
      if (slot.currentUserIds.includes(userId)) {
        slot.currentUserIds = slot.currentUserIds.filter(id => id !== userId);
      } else {
        slot.currentUserIds = [...slot.currentUserIds, userId];
      }
      updated[slotIndex] = slot;
      return updated;
    });
  };

  const getPickerNames = (userIds: string[]) => {
    if (userIds.length === 0) return null;
    return userIds.map(id => profiles.find(p => p.user_id === id)?.display_name || '?').join(' & ');
  };

  const hasChanges = slots.some(s => {
    const orig = [...s.originalUserIds].sort().join(',');
    const curr = [...s.currentUserIds].sort().join(',');
    return orig !== curr;
  });

  const changedCount = slots.filter(s => {
    const orig = [...s.originalUserIds].sort().join(',');
    const curr = [...s.currentUserIds].sort().join(',');
    return orig !== curr;
  }).length;

  const handleSave = async () => {
    if (!hasChanges) return;
    setLoading(true);
    try {
      for (const slot of slots) {
        const orig = [...slot.originalUserIds].sort().join(',');
        const curr = [...slot.currentUserIds].sort().join(',');
        if (orig === curr) continue;
        if (slot.currentUserIds.length === 0) {
          toast.error(`"${slot.title}" must have at least one picker`);
          setLoading(false);
          return;
        }

        const origSet = new Set(slot.originalUserIds);
        const currSet = new Set(slot.currentUserIds);

        // Update existing picks that are staying but changing user_id
        // Keep as many existing pick rows as possible to preserve guess references
        const keepUserIds = slot.currentUserIds.filter(id => origSet.has(id));
        const addUserIds = slot.currentUserIds.filter(id => !origSet.has(id));
        const removeUserIds = slot.originalUserIds.filter(id => !currSet.has(id));

        // For users being removed: if there's a new user to add, update the row instead of deleting
        const pickIdsByUser = new Map<string, string>();
        slot.originalUserIds.forEach((uid, i) => {
          if (slot.pickIds[i]) pickIdsByUser.set(uid, slot.pickIds[i]);
        });

        for (const removeId of removeUserIds) {
          const pickId = pickIdsByUser.get(removeId);
          if (!pickId) continue;
          if (addUserIds.length > 0) {
            // Reassign this pick row to a new user (preserves the pick ID for guesses)
            const newUserId = addUserIds.shift()!;
            const { error } = await supabase.from('movie_picks').update({ user_id: newUserId }).eq('id', pickId);
            if (error) throw error;
          } else {
            // No one to reassign to, delete the extra row
            await supabase.from('movie_picks').delete().eq('id', pickId);
          }
        }

        // Any remaining new users that didn't replace an existing row — insert new picks
        for (const newUserId of addUserIds) {
          const { error } = await supabase.from('movie_picks').insert({
            season_id: selectedSeason,
            user_id: newUserId,
            title: slot.title,
            watch_order: slot.watchOrder,
            revealed: true,
          });
          if (error) throw error;
        }
      }

      toast.success(`Updated pickers for ${changedCount} movie(s)!`);
      // Refresh
      const { data } = await supabase
        .from('movie_picks')
        .select('id, title, user_id, watch_order')
        .eq('season_id', selectedSeason)
        .order('watch_order', { ascending: true });
      const picks = (data || []) as PickRow[];
      const grouped = new Map<number | string, PickRow[]>();
      picks.forEach(p => {
        const key = p.watch_order ?? p.id;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(p);
      });
      setSlots(
        Array.from(grouped.entries())
          .sort(([a], [b]) => (typeof a === 'number' ? a : 999) - (typeof b === 'number' ? b : 999))
          .map(([, picks]) => ({
            watchOrder: picks[0].watch_order,
            title: picks[0].title,
            pickIds: picks.map(p => p.id),
            originalUserIds: picks.map(p => p.user_id),
            currentUserIds: picks.map(p => p.user_id),
          }))
      );
      onUpdated();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update picks');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FilePenLine className="w-4 h-4 mr-1" /> Edit Picks
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Movie Picks</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">{labels.seasonNoun}</label>
            <Select value={selectedSeason} onValueChange={setSelectedSeason}>
              <SelectTrigger className="bg-muted/50">
                <SelectValue placeholder="Select a season" />
              </SelectTrigger>
              <SelectContent>
                {seasons.map(s => (
                  <SelectItem key={s.id} value={s.id}>
                    {labels.seasonNoun} {s.season_number}{s.title ? ` — ${s.title}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedSeason && slots.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No movie picks in this season.</p>
          )}

          {slots.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">Change who picked each movie:</p>
              <div className="space-y-2">
                {slots.map((slot, i) => {
                  const isEdited = [...slot.originalUserIds].sort().join(',') !== [...slot.currentUserIds].sort().join(',');
                  return (
                    <div key={`${slot.watchOrder}-${i}`} className={`flex items-center gap-3 rounded-xl p-3 ${isEdited ? 'bg-primary/10 ring-1 ring-primary/20' : 'bg-muted/20'}`}>
                      <span className="text-xs text-muted-foreground w-5 shrink-0">{(slot.watchOrder ?? i) + 1}.</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{slot.title}</p>
                      </div>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="h-8 text-xs bg-muted/50 font-normal max-w-[160px]">
                            <span className="truncate">{getPickerNames(slot.currentUserIds) || 'Select'}</span>
                            <ChevronDown className="w-3 h-3 ml-1 shrink-0 text-muted-foreground" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-48 p-2" align="end">
                          {profiles.map(p => (
                            <label
                              key={p.user_id}
                              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 cursor-pointer"
                            >
                              <Checkbox
                                checked={slot.currentUserIds.includes(p.user_id)}
                                onCheckedChange={() => togglePicker(i, p.user_id)}
                              />
                              <span className="text-sm">{p.display_name}</span>
                            </label>
                          ))}
                        </PopoverContent>
                      </Popover>
                    </div>
                  );
                })}
              </div>

              <Button variant="gold" onClick={handleSave} disabled={loading || !hasChanges} className="w-full">
                <Save className="w-4 h-4 mr-1" />
                {loading ? 'Saving...' : `Save ${changedCount} Change${changedCount !== 1 ? 's' : ''}`}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EditPicksDialog;
