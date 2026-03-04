import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Group, Profile } from '@/hooks/useGroup';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ClipboardList, Check, CheckCircle2, Circle } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  group: Group;
  profiles: Profile[];
  onImported: () => void;
}

interface SeasonOption {
  id: string;
  season_number: number;
  title: string | null;
}

interface MoviePickOption {
  id: string;
  title: string;
  user_id: string;
  watch_order: number | null;
}

const ImportGuessesDialog = ({ group, profiles, onImported }: Props) => {
  const [open, setOpen] = useState(false);
  const [seasons, setSeasons] = useState<SeasonOption[]>([]);
  const [selectedSeason, setSelectedSeason] = useState('');
  const [selectedGuesser, setSelectedGuesser] = useState('');
  const [picks, setPicks] = useState<MoviePickOption[]>([]);
  const [guesses, setGuesses] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [guessersWithData, setGuessersWithData] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    const fetchSeasons = async () => {
      const { data } = await supabase
        .from('seasons')
        .select('id, season_number, title')
        .eq('group_id', group.id)
        .order('season_number', { ascending: true });
      setSeasons(data || []);
    };
    fetchSeasons();
  }, [open, group.id]);

  // Fetch picks and existing guessers when season changes
  useEffect(() => {
    if (!selectedSeason) { setPicks([]); setGuessersWithData(new Set()); return; }
    const fetchData = async () => {
      const [picksRes, guessesRes] = await Promise.all([
        supabase.from('movie_picks').select('id, title, user_id, watch_order').eq('season_id', selectedSeason).order('watch_order', { ascending: true }),
        supabase.from('guesses').select('guesser_id').eq('season_id', selectedSeason),
      ]);
      setPicks((picksRes.data || []) as MoviePickOption[]);
      const uniqueGuessers = new Set((guessesRes.data || []).map(g => g.guesser_id));
      setGuessersWithData(uniqueGuessers);
      setGuesses({});
    };
    fetchData();
  }, [selectedSeason]);

  // Reset guesses when guesser changes
  useEffect(() => { setGuesses({}); }, [selectedGuesser]);

  const getProfile = (userId: string) => profiles.find(p => p.user_id === userId);

  const guessableMovies = picks.filter(p => p.user_id !== selectedGuesser);
  const guessableMembers = profiles.filter(p => p.user_id !== selectedGuesser);
  const filledCount = Object.values(guesses).filter(Boolean).length;

  const handleImport = async () => {
    const valid = Object.entries(guesses).filter(([, v]) => v);
    if (valid.length === 0) { toast.error('No guesses to import'); return; }
    setLoading(true);
    try {
      const rows = valid.map(([movie_pick_id, guessed_user_id]) => ({
        season_id: selectedSeason,
        guesser_id: selectedGuesser,
        movie_pick_id,
        guessed_user_id,
      }));
      const { error } = await supabase.from('guesses').insert(rows);
      if (error) throw error;
      toast.success(`Imported ${valid.length} guesses for ${getProfile(selectedGuesser)?.display_name}!`);
      setGuesses({});
      setGuessersWithData(prev => new Set([...prev, selectedGuesser]));
      setSelectedGuesser('');
      onImported();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to import guesses');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ClipboardList className="w-4 h-4 mr-1" /> Import Guesses
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Guesses</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Season selector */}
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Season</label>
            <Select value={selectedSeason} onValueChange={(v) => { setSelectedSeason(v); setSelectedGuesser(''); }}>
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

          {/* Member selector with status indicators */}
          {selectedSeason && (
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Member (guesser)</label>
              <div className="space-y-1 mb-2">
                {profiles.map(p => {
                  const hasGuesses = guessersWithData.has(p.user_id);
                  const isSelected = selectedGuesser === p.user_id;
                  return (
                    <button
                      key={p.user_id}
                      onClick={() => setSelectedGuesser(p.user_id)}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                        isSelected
                          ? 'bg-primary/10 ring-1 ring-primary/30'
                          : 'bg-muted/20 hover:bg-muted/40'
                      }`}
                    >
                      {hasGuesses ? (
                        <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                      ) : (
                        <Circle className="w-4 h-4 text-muted-foreground shrink-0" />
                      )}
                      <span className="flex-1">{p.display_name}</span>
                      <span className={`text-xs ${hasGuesses ? 'text-primary' : 'text-muted-foreground'}`}>
                        {hasGuesses ? 'Recorded' : 'Missing'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Movie guesses */}
          {selectedGuesser && guessableMovies.length > 0 && (
            <>
              {guessersWithData.has(selectedGuesser) && (
                <div className="text-xs text-primary bg-primary/5 rounded-lg p-2 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Guesses already recorded for {getProfile(selectedGuesser)?.display_name}. Importing will add duplicates.
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                For each movie, select who {getProfile(selectedGuesser)?.display_name} guessed picked it:
              </p>
              <div className="space-y-2">
                {guessableMovies.map(pick => (
                  <div key={pick.id} className="flex items-center gap-3 bg-muted/20 rounded-xl p-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{pick.title}</p>
                    </div>
                    <Select value={guesses[pick.id] || ''} onValueChange={v => setGuesses(prev => ({ ...prev, [pick.id]: v }))}>
                      <SelectTrigger className="w-36 bg-muted/50 text-xs h-8">
                        <SelectValue placeholder="Who picked?" />
                      </SelectTrigger>
                      <SelectContent>
                        {guessableMembers.map(p => (
                          <SelectItem key={p.user_id} value={p.user_id}>{p.display_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>

              <Button variant="gold" onClick={handleImport} disabled={loading || filledCount === 0} className="w-full">
                <Check className="w-4 h-4 mr-1" />
                {loading ? 'Importing...' : `Import ${filledCount} Guesses`}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ImportGuessesDialog;
