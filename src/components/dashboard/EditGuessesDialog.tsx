import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Group, Profile } from '@/hooks/useGroup';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Pencil, Save, Plus } from 'lucide-react';
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

interface PickInfo {
  id: string;
  title: string;
  user_id: string;
  watch_order: number | null;
}

interface GuessRow {
  id: string;
  movie_pick_id: string;
  guessed_user_id: string;
}

interface MovieSlot {
  pickId: string; // representative pick id for this slot
  title: string;
  watchOrder: number | null;
  pickerUserIds: string[];
}

const EditGuessesDialog = ({ group, profiles, onUpdated }: Props) => {
  const [open, setOpen] = useState(false);
  const [seasons, setSeasons] = useState<SeasonOption[]>([]);
  const [selectedSeason, setSelectedSeason] = useState('');
  const [selectedGuesser, setSelectedGuesser] = useState('');
  const [picks, setPicks] = useState<PickInfo[]>([]);
  const [existingGuesses, setExistingGuesses] = useState<GuessRow[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [newGuesses, setNewGuesses] = useState<Record<string, string>>({}); // pickId -> guessed_user_id
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
    if (!selectedSeason) { setPicks([]); return; }
    supabase
      .from('movie_picks')
      .select('id, title, user_id, watch_order')
      .eq('season_id', selectedSeason)
      .order('watch_order', { ascending: true })
      .then(({ data }) => setPicks((data || []) as PickInfo[]));
  }, [selectedSeason]);

  useEffect(() => {
    if (!selectedSeason || !selectedGuesser) { setExistingGuesses([]); setEdits({}); setNewGuesses({}); return; }
    supabase
      .from('guesses')
      .select('id, movie_pick_id, guessed_user_id')
      .eq('season_id', selectedSeason)
      .eq('guesser_id', selectedGuesser)
      .then(({ data }) => {
        setExistingGuesses((data || []) as GuessRow[]);
        setEdits({});
        setNewGuesses({});
      });
  }, [selectedSeason, selectedGuesser]);

  const getProfile = (userId: string) => profiles.find(p => p.user_id === userId);

  // Group picks by watch_order to identify co-picks and build movie slots
  const movieSlots: MovieSlot[] = (() => {
    const grouped = new Map<number | string, PickInfo[]>();
    picks.forEach(p => {
      const key = p.watch_order ?? p.id;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(p);
    });
    return Array.from(grouped.entries())
      .sort(([a], [b]) => (typeof a === 'number' ? a : 999) - (typeof b === 'number' ? b : 999))
      .map(([, groupPicks]) => ({
        pickId: groupPicks[0].id,
        title: groupPicks[0].title,
        watchOrder: groupPicks[0].watch_order,
        pickerUserIds: groupPicks.map(p => p.user_id),
      }));
  })();

  // Determine which slots the guesser should NOT guess on (their own picks, including co-picks)
  const guesserPickSlots = new Set(
    movieSlots.filter(s => s.pickerUserIds.includes(selectedGuesser)).map(s => s.pickId)
  );

  // Guessable slots = slots the guesser didn't pick
  const guessableSlots = movieSlots.filter(s => !guesserPickSlots.has(s.pickId));

  // Which guessable slots already have a guess?
  const guessedPickIds = new Set(existingGuesses.map(g => g.movie_pick_id));
  const missingSlots = guessableSlots.filter(s => !guessedPickIds.has(s.pickId));

  // Build guess options (exclude guesser and co-pickers from their own group)
  const guessOptions = profiles.filter(p => p.user_id !== selectedGuesser);

  const hasEdits = Object.keys(edits).length > 0;
  const hasNewGuesses = Object.values(newGuesses).filter(Boolean).length > 0;
  const hasChanges = hasEdits || hasNewGuesses;

  const handleSave = async () => {
    if (!hasChanges) return;
    setLoading(true);
    try {
      // Update existing guesses
      for (const [guessId, newGuessedUserId] of Object.entries(edits)) {
        const { error } = await supabase
          .from('guesses')
          .update({ guessed_user_id: newGuessedUserId })
          .eq('id', guessId);
        if (error) throw error;
      }

      // Insert new guesses
      const newRows = Object.entries(newGuesses)
        .filter(([, v]) => v)
        .map(([movie_pick_id, guessed_user_id]) => ({
          season_id: selectedSeason,
          guesser_id: selectedGuesser,
          movie_pick_id,
          guessed_user_id,
        }));
      if (newRows.length > 0) {
        const { error } = await supabase.from('guesses').insert(newRows);
        if (error) throw error;
      }

      const totalChanges = Object.keys(edits).length + newRows.length;
      toast.success(`Saved ${totalChanges} change(s)!`);

      // Refresh
      const { data } = await supabase
        .from('guesses')
        .select('id, movie_pick_id, guessed_user_id')
        .eq('season_id', selectedSeason)
        .eq('guesser_id', selectedGuesser);
      setExistingGuesses((data || []) as GuessRow[]);
      setEdits({});
      setNewGuesses({});
      onUpdated();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save guesses');
    } finally {
      setLoading(false);
    }
  };

  const getPickTitle = (pickId: string) => picks.find(p => p.id === pickId)?.title || 'Unknown';

  const changeCount = Object.keys(edits).length + Object.values(newGuesses).filter(Boolean).length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="w-4 h-4 mr-1" /> Edit Guesses
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Guesses</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Season</label>
            <Select value={selectedSeason} onValueChange={v => { setSelectedSeason(v); setSelectedGuesser(''); }}>
              <SelectTrigger className="bg-muted/50">
                <SelectValue placeholder="Select a season" />
              </SelectTrigger>
              <SelectContent>
                {seasons.map(s => (
                  <SelectItem key={s.id} value={s.id}>
                    Season {s.season_number}{s.title ? ` — ${s.title}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedSeason && (
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Member (guesser)</label>
              <Select value={selectedGuesser} onValueChange={setSelectedGuesser}>
                <SelectTrigger className="bg-muted/50">
                  <SelectValue placeholder="Select a member" />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map(p => (
                    <SelectItem key={p.user_id} value={p.user_id}>{p.display_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {selectedGuesser && existingGuesses.length === 0 && missingSlots.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No guessable movies for {getProfile(selectedGuesser)?.display_name} in this season.
            </p>
          )}

          {selectedGuesser && (existingGuesses.length > 0 || missingSlots.length > 0) && (
            <>
              {/* Existing guesses */}
              {existingGuesses.length > 0 && (
                <>
                  <p className="text-xs text-muted-foreground">
                    Edit {getProfile(selectedGuesser)?.display_name}'s guesses:
                  </p>
                  <div className="space-y-2">
                    {existingGuesses.map(guess => {
                      const currentValue = edits[guess.id] ?? guess.guessed_user_id;
                      const isEdited = edits[guess.id] !== undefined;
                      return (
                        <div key={guess.id} className={`flex items-center gap-3 rounded-xl p-3 ${isEdited ? 'bg-primary/10 ring-1 ring-primary/20' : 'bg-muted/20'}`}>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{getPickTitle(guess.movie_pick_id)}</p>
                          </div>
                          <Select
                            value={currentValue}
                            onValueChange={v => {
                              setEdits(prev => {
                                if (v === guess.guessed_user_id) {
                                  const next = { ...prev };
                                  delete next[guess.id];
                                  return next;
                                }
                                return { ...prev, [guess.id]: v };
                              });
                            }}
                          >
                            <SelectTrigger className="w-36 bg-muted/50 text-xs h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {guessOptions.map(p => (
                                <SelectItem key={p.user_id} value={p.user_id}>{p.display_name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* Missing guesses */}
              {missingSlots.length > 0 && (
                <>
                  <div className="flex items-center gap-2 mt-2">
                    <Plus className="w-3.5 h-3.5 text-primary" />
                    <p className="text-xs text-muted-foreground">
                      Missing guesses ({missingSlots.length}):
                    </p>
                  </div>
                  <div className="space-y-2">
                    {missingSlots.map(slot => (
                      <div key={slot.pickId} className={`flex items-center gap-3 rounded-xl p-3 ${newGuesses[slot.pickId] ? 'bg-primary/10 ring-1 ring-primary/20' : 'bg-muted/20 border border-dashed border-muted-foreground/20'}`}>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{slot.title}</p>
                          <p className="text-xs text-muted-foreground">No guess recorded</p>
                        </div>
                        <Select
                          value={newGuesses[slot.pickId] || ''}
                          onValueChange={v => setNewGuesses(prev => ({ ...prev, [slot.pickId]: v }))}
                        >
                          <SelectTrigger className="w-36 bg-muted/50 text-xs h-8">
                            <SelectValue placeholder="Who picked?" />
                          </SelectTrigger>
                          <SelectContent>
                            {guessOptions.map(p => (
                              <SelectItem key={p.user_id} value={p.user_id}>{p.display_name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <Button variant="gold" onClick={handleSave} disabled={loading || !hasChanges} className="w-full">
                <Save className="w-4 h-4 mr-1" />
                {loading ? 'Saving...' : `Save ${changeCount} Change${changeCount !== 1 ? 's' : ''}`}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EditGuessesDialog;
