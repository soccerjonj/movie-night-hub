import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Group, Profile } from '@/hooks/useGroup';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Pencil, Save } from 'lucide-react';
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

const EditGuessesDialog = ({ group, profiles, onUpdated }: Props) => {
  const [open, setOpen] = useState(false);
  const [seasons, setSeasons] = useState<SeasonOption[]>([]);
  const [selectedSeason, setSelectedSeason] = useState('');
  const [selectedGuesser, setSelectedGuesser] = useState('');
  const [picks, setPicks] = useState<PickInfo[]>([]);
  const [existingGuesses, setExistingGuesses] = useState<GuessRow[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({}); // guessId -> new guessed_user_id
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
    if (!selectedSeason || !selectedGuesser) { setExistingGuesses([]); setEdits({}); return; }
    supabase
      .from('guesses')
      .select('id, movie_pick_id, guessed_user_id')
      .eq('season_id', selectedSeason)
      .eq('guesser_id', selectedGuesser)
      .then(({ data }) => {
        setExistingGuesses((data || []) as GuessRow[]);
        setEdits({});
      });
  }, [selectedSeason, selectedGuesser]);

  const getProfile = (userId: string) => profiles.find(p => p.user_id === userId);

  const getPickTitle = (pickId: string) => picks.find(p => p.id === pickId)?.title || 'Unknown';

  // Build guess options excluding the guesser themselves
  const guessOptions = profiles.filter(p => p.user_id !== selectedGuesser);

  const hasChanges = Object.keys(edits).length > 0;

  const handleSave = async () => {
    if (!hasChanges) return;
    setLoading(true);
    try {
      for (const [guessId, newGuessedUserId] of Object.entries(edits)) {
        const { error } = await supabase
          .from('guesses')
          .update({ guessed_user_id: newGuessedUserId })
          .eq('id', guessId);
        if (error) throw error;
      }
      toast.success(`Updated ${Object.keys(edits).length} guess(es)!`);
      setEdits({});
      // Refresh
      const { data } = await supabase
        .from('guesses')
        .select('id, movie_pick_id, guessed_user_id')
        .eq('season_id', selectedSeason)
        .eq('guesser_id', selectedGuesser);
      setExistingGuesses((data || []) as GuessRow[]);
      onUpdated();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update guesses');
    } finally {
      setLoading(false);
    }
  };

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

          {selectedGuesser && existingGuesses.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No guesses recorded for {getProfile(selectedGuesser)?.display_name} in this season.
            </p>
          )}

          {selectedGuesser && existingGuesses.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">
                Change who {getProfile(selectedGuesser)?.display_name} guessed for each movie:
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

              <Button variant="gold" onClick={handleSave} disabled={loading || !hasChanges} className="w-full">
                <Save className="w-4 h-4 mr-1" />
                {loading ? 'Saving...' : `Save ${Object.keys(edits).length} Change${Object.keys(edits).length !== 1 ? 's' : ''}`}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EditGuessesDialog;
