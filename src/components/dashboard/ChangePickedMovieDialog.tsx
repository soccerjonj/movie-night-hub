import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Group, Profile } from '@/hooks/useGroup';
import { getClubLabels } from '@/lib/clubTypes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Replace, Search, Film, ArrowLeft, Check } from 'lucide-react';
import { toast } from 'sonner';
import { TMDB_API_TOKEN } from '@/lib/apiKeys';

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
  poster_url: string | null;
  year: string | null;
}

interface MovieSlot {
  watchOrder: number | null;
  title: string;
  poster_url: string | null;
  year: string | null;
  pickIds: string[];
  userIds: string[];
}

interface TMDBMovie {
  id: number;
  title: string;
  poster_path: string | null;
  release_date: string;
  overview: string;
  vote_average: number;
  vote_count: number;
  popularity: number;
}

const TMDB_IMG = 'https://image.tmdb.org/t/p/w200';

const ChangePickedMovieDialog = ({ group, profiles, onUpdated }: Props) => {
  const labels = getClubLabels(group.club_type);
  const [open, setOpen] = useState(false);
  const [seasons, setSeasons] = useState<SeasonOption[]>([]);
  const [selectedSeason, setSelectedSeason] = useState('');
  const [slots, setSlots] = useState<MovieSlot[]>([]);
  const [editingSlot, setEditingSlot] = useState<MovieSlot | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TMDBMovie[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedSeason('');
    setSlots([]);
    setEditingSlot(null);
    setQuery('');
    setResults([]);
    supabase
      .from('seasons')
      .select('id, season_number, title')
      .eq('group_id', group.id)
      .order('season_number', { ascending: false })
      .then(({ data }) => setSeasons(data || []));
  }, [open, group.id]);

  const loadSlots = async (seasonId: string) => {
    const { data } = await supabase
      .from('movie_picks')
      .select('id, title, user_id, watch_order, poster_url, year')
      .eq('season_id', seasonId)
      .order('watch_order', { ascending: true });
    const picks = (data || []) as PickRow[];
    const grouped = new Map<number | string, PickRow[]>();
    picks.forEach(p => {
      const key = p.watch_order ?? p.id;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(p);
    });
    const movieSlots: MovieSlot[] = Array.from(grouped.entries())
      .sort(([a], [b]) => (typeof a === 'number' ? a : 999) - (typeof b === 'number' ? b : 999))
      .map(([, ps]) => ({
        watchOrder: ps[0].watch_order,
        title: ps[0].title,
        poster_url: ps[0].poster_url,
        year: ps[0].year,
        pickIds: ps.map(p => p.id),
        userIds: ps.map(p => p.user_id),
      }));
    setSlots(movieSlots);
  };

  useEffect(() => {
    if (!selectedSeason) { setSlots([]); return; }
    loadSlots(selectedSeason);
  }, [selectedSeason]);

  // Debounced TMDB search
  useEffect(() => {
    if (!editingSlot) return;
    if (!query.trim()) { setResults([]); return; }
    if (!TMDB_API_TOKEN) {
      toast.error('TMDB API token is missing.');
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(query)}&include_adult=false&language=en-US&page=1`,
          { headers: { Authorization: `Bearer ${TMDB_API_TOKEN}`, Accept: 'application/json' } },
        );
        if (!res.ok) throw new Error('TMDB search failed');
        const data = await res.json();
        const sorted = ((data.results || []) as TMDBMovie[]).sort((a, b) => {
          const sa = (a.vote_count || 0) * 0.5 + (a.popularity || 0);
          const sb = (b.vote_count || 0) * 0.5 + (b.popularity || 0);
          return sb - sa;
        });
        setResults(sorted.slice(0, 12));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Search failed');
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [query, editingSlot]);

  const getPickerNames = (userIds: string[]) =>
    userIds.map(id => profiles.find(p => p.user_id === id)?.display_name || '?').join(' & ');

  const replaceMovie = async (movie: TMDBMovie) => {
    if (!editingSlot) return;
    setSaving(true);
    try {
      // Update all co-pick rows in-place to preserve guess/ranking foreign keys
      for (const pickId of editingSlot.pickIds) {
        const { error } = await supabase.from('movie_picks').update({
          tmdb_id: movie.id,
          title: movie.title,
          poster_url: movie.poster_path ? `${TMDB_IMG}${movie.poster_path}` : null,
          year: movie.release_date?.split('-')[0] || null,
          overview: movie.overview || null,
        }).eq('id', pickId);
        if (error) throw error;
      }
      toast.success(`Changed to "${movie.title}"`);
      setEditingSlot(null);
      setQuery('');
      setResults([]);
      await loadSlots(selectedSeason);
      onUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Replace className="w-4 h-4 mr-1" /> Change Picked {labels.Item}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Change Picked {labels.Item}</DialogTitle>
        </DialogHeader>

        {!editingSlot && (
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{labels.seasonNoun}</label>
              <Select value={selectedSeason} onValueChange={setSelectedSeason}>
                <SelectTrigger className="bg-muted/50">
                  <SelectValue placeholder="Select any season" />
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
              <p className="text-sm text-muted-foreground text-center py-4">No {labels.items} in this season.</p>
            )}

            {slots.length > 0 && (
              <>
                <p className="text-xs text-muted-foreground">
                  Tap a {labels.item} to swap it for a different one. Guesses and rankings are preserved.
                </p>
                <div className="space-y-2">
                  {slots.map((slot, i) => (
                    <button
                      key={`${slot.watchOrder}-${i}`}
                      onClick={() => { setEditingSlot(slot); setQuery(slot.title); }}
                      className="w-full flex items-center gap-3 rounded-xl p-2.5 bg-muted/20 hover:bg-muted/40 transition-colors text-left"
                    >
                      {slot.poster_url ? (
                        <img src={slot.poster_url} alt={slot.title} className="w-9 rounded-md object-cover shrink-0" />
                      ) : (
                        <div className="w-9 h-12 rounded-md bg-muted flex items-center justify-center shrink-0">
                          <Film className="w-4 h-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{slot.title}{slot.year ? ` (${slot.year})` : ''}</p>
                        <p className="text-[11px] text-muted-foreground truncate">Picked by {getPickerNames(slot.userIds)}</p>
                      </div>
                      <Replace className="w-4 h-4 text-muted-foreground shrink-0" />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {editingSlot && (
          <div className="space-y-3">
            <Button variant="ghost" size="sm" onClick={() => { setEditingSlot(null); setQuery(''); setResults([]); }} className="-ml-2">
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            <div className="rounded-lg bg-muted/30 p-2.5 text-xs">
              <span className="text-muted-foreground">Replacing: </span>
              <span className="font-medium">{editingSlot.title}{editingSlot.year ? ` (${editingSlot.year})` : ''}</span>
              <div className="text-muted-foreground mt-0.5">Picked by {getPickerNames(editingSlot.userIds)}</div>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={`Search for a ${labels.item}...`}
                className="pl-9"
                autoFocus
              />
            </div>
            {searching && <p className="text-xs text-muted-foreground text-center">Searching...</p>}
            <div className="space-y-2">
              {results.map(movie => (
                <button
                  key={movie.id}
                  onClick={() => replaceMovie(movie)}
                  disabled={saving}
                  className="w-full flex items-center gap-3 rounded-xl p-2.5 bg-muted/20 hover:bg-primary/10 transition-colors text-left disabled:opacity-50"
                >
                  {movie.poster_path ? (
                    <img src={`${TMDB_IMG}${movie.poster_path}`} alt={movie.title} className="w-10 rounded-md object-cover shrink-0" />
                  ) : (
                    <div className="w-10 h-14 rounded-md bg-muted flex items-center justify-center shrink-0">
                      <Film className="w-4 h-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{movie.title}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {movie.release_date?.split('-')[0] || '—'}
                      {movie.overview ? ` · ${movie.overview}` : ''}
                    </p>
                  </div>
                  <Check className="w-4 h-4 text-muted-foreground shrink-0" />
                </button>
              ))}
              {!searching && query.trim() && results.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No results.</p>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ChangePickedMovieDialog;
