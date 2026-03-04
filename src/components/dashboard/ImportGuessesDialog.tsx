import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Group, Profile } from '@/hooks/useGroup';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ClipboardList, Plus, Trash2 } from 'lucide-react';
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

interface GuessEntry {
  guesser_id: string;
  movie_pick_id: string;
  guessed_user_id: string;
}

const ImportGuessesDialog = ({ group, profiles, onImported }: Props) => {
  const [open, setOpen] = useState(false);
  const [seasons, setSeasons] = useState<SeasonOption[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<string>('');
  const [picks, setPicks] = useState<MoviePickOption[]>([]);
  const [entries, setEntries] = useState<GuessEntry[]>([]);
  const [loading, setLoading] = useState(false);

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

  useEffect(() => {
    if (!selectedSeason) { setPicks([]); setEntries([]); return; }
    const fetchPicks = async () => {
      const { data } = await supabase
        .from('movie_picks')
        .select('id, title, user_id, watch_order')
        .eq('season_id', selectedSeason)
        .order('watch_order', { ascending: true });
      setPicks((data || []) as MoviePickOption[]);
      setEntries([]);
    };
    fetchPicks();
  }, [selectedSeason]);

  const addEntry = () => {
    setEntries(prev => [...prev, { guesser_id: '', movie_pick_id: '', guessed_user_id: '' }]);
  };

  const updateEntry = (index: number, field: keyof GuessEntry, value: string) => {
    setEntries(prev => prev.map((e, i) => i === index ? { ...e, [field]: value } : e));
  };

  const removeEntry = (index: number) => {
    setEntries(prev => prev.filter((_, i) => i !== index));
  };

  const getProfile = (userId: string) => profiles.find(p => p.user_id === userId);

  const handleImport = async () => {
    const valid = entries.filter(e => e.guesser_id && e.movie_pick_id && e.guessed_user_id);
    if (valid.length === 0) { toast.error('No valid guesses to import'); return; }
    setLoading(true);
    try {
      const rows = valid.map(e => ({
        season_id: selectedSeason,
        guesser_id: e.guesser_id,
        movie_pick_id: e.movie_pick_id,
        guessed_user_id: e.guessed_user_id,
      }));
      const { error } = await supabase.from('guesses').insert(rows);
      if (error) throw error;
      toast.success(`Imported ${valid.length} guesses!`);
      setOpen(false);
      setEntries([]);
      setSelectedSeason('');
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
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Guesses</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Season selector */}
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Season</label>
            <Select value={selectedSeason} onValueChange={setSelectedSeason}>
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

          {selectedSeason && picks.length > 0 && (
            <>
              {/* Guess entries */}
              <div className="space-y-3">
                {entries.map((entry, i) => (
                  <div key={i} className="flex items-center gap-2 bg-muted/20 rounded-xl p-3">
                    <div className="flex-1 space-y-2">
                      <Select value={entry.guesser_id} onValueChange={v => updateEntry(i, 'guesser_id', v)}>
                        <SelectTrigger className="bg-muted/50 text-xs h-8">
                          <SelectValue placeholder="Who guessed?" />
                        </SelectTrigger>
                        <SelectContent>
                          {profiles.map(p => (
                            <SelectItem key={p.user_id} value={p.user_id}>{p.display_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex gap-2">
                        <Select value={entry.movie_pick_id} onValueChange={v => updateEntry(i, 'movie_pick_id', v)}>
                          <SelectTrigger className="bg-muted/50 text-xs h-8 flex-1">
                            <SelectValue placeholder="Movie" />
                          </SelectTrigger>
                          <SelectContent>
                            {picks.map(p => (
                              <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select value={entry.guessed_user_id} onValueChange={v => updateEntry(i, 'guessed_user_id', v)}>
                          <SelectTrigger className="bg-muted/50 text-xs h-8 flex-1">
                            <SelectValue placeholder="Guessed picker" />
                          </SelectTrigger>
                          <SelectContent>
                            {profiles.map(p => (
                              <SelectItem key={p.user_id} value={p.user_id}>{p.display_name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeEntry(i)}>
                      <Trash2 className="w-3 h-3 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>

              <Button variant="outline" size="sm" onClick={addEntry} className="w-full">
                <Plus className="w-4 h-4 mr-1" /> Add Guess
              </Button>

              {entries.length > 0 && (
                <Button variant="gold" onClick={handleImport} disabled={loading} className="w-full">
                  {loading ? 'Importing...' : `Import ${entries.filter(e => e.guesser_id && e.movie_pick_id && e.guessed_user_id).length} Guesses`}
                </Button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ImportGuessesDialog;
