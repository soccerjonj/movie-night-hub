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

  // Find co-pickers: users who share the same watch_order as the guesser
  const guesserPicks = picks.filter(p => p.user_id === selectedGuesser);
  const guesserWatchOrders = new Set(guesserPicks.map(p => p.watch_order));
  const coPickers = new Set(
    picks
      .filter(p => p.user_id !== selectedGuesser && guesserWatchOrders.has(p.watch_order))
      .map(p => p.user_id)
  );
  const excludedUserIds = new Set([selectedGuesser, ...coPickers]);

  // Group picks by watch_order to show co-picks as one entry
  const groupedPicks = picks.reduce((acc, pick) => {
    const key = pick.watch_order ?? pick.id;
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key)!.push(pick);
    return acc;
  }, new Map<number | string, MoviePickOption[]>());

  // Filter out movies where the guesser (or their co-picker group) is involved
  const guessableGroups = Array.from(groupedPicks.entries())
    .filter(([, groupPicks]) => !groupPicks.some(p => excludedUserIds.has(p.user_id)))
    .sort(([a], [b]) => (typeof a === 'number' ? a : 0) - (typeof b === 'number' ? b : 0));

  // Build guess options: co-pick groups as combined, and only individual members who aren't part of a co-pick
  const coPickUserIds = new Set<string>();
  const guessOptions: { value: string; label: string }[] = [];

  guessableGroups.forEach(([, groupPicks]) => {
    if (groupPicks.length > 1) {
      const ids = groupPicks.map(p => p.user_id).sort().join('+');
      const names = groupPicks.map(p => getProfile(p.user_id)?.display_name || '?').join(' & ');
      groupPicks.forEach(p => coPickUserIds.add(p.user_id));
      if (!guessOptions.find(o => o.value === ids)) {
        guessOptions.push({ value: ids, label: names });
      }
    }
  });

  // Only add individual members who are NOT part of any co-pick group
  profiles
    .filter(p => !excludedUserIds.has(p.user_id) && !coPickUserIds.has(p.user_id))
    .forEach(p => {
      guessOptions.push({ value: p.user_id, label: p.display_name });
    });
  const filledCount = Object.values(guesses).filter(Boolean).length;

  const handleImport = async () => {
    const valid = Object.entries(guesses).filter(([, v]) => v);
    if (valid.length === 0) { toast.error('No guesses to import'); return; }
    setLoading(true);
    try {
      // For co-pick guesses, the value is "userId1+userId2" — store as guessed_user_id for the first user
      // (the guess is correct if it matches any co-picker in that group)
      const rows = valid.map(([movie_pick_id, guessed_value]) => ({
        season_id: selectedSeason,
        guesser_id: selectedGuesser,
        movie_pick_id,
        guessed_user_id: guessed_value.includes('+') ? guessed_value.split('+')[0] : guessed_value,
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
          {selectedGuesser && guessableGroups.length > 0 && (
            <>
              {guessersWithData.has(selectedGuesser) && (
                <div className="text-xs text-primary bg-primary/5 rounded-lg p-2 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Guesses already recorded for {getProfile(selectedGuesser)?.display_name}. Importing will add duplicates.
                </div>
              )}
              {coPickers.size > 0 && (
                <div className="text-xs text-muted-foreground bg-muted/20 rounded-lg p-2">
                  Co-picked with {[...coPickers].map(id => getProfile(id)?.display_name).join(', ')} — their shared movie and names are excluded.
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                For each movie, select who {getProfile(selectedGuesser)?.display_name} guessed picked it:
              </p>
              <div className="space-y-2">
                {guessableGroups.map(([key, groupPicks]) => {
                  const pickId = groupPicks[0].id;
                  return (
                    <div key={key} className="flex items-center gap-3 bg-muted/20 rounded-xl p-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{groupPicks[0].title}</p>
                      </div>
                      <Select value={guesses[pickId] || ''} onValueChange={v => setGuesses(prev => ({ ...prev, [pickId]: v }))}>
                        <SelectTrigger className="w-36 bg-muted/50 text-xs h-8">
                          <SelectValue placeholder="Who picked?" />
                        </SelectTrigger>
                        <SelectContent>
                          {guessOptions.map(o => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
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
