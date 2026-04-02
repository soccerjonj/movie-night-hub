import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Season, MoviePick, GroupMember, Profile } from '@/hooks/useGroup';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Check, Film, Star, ExternalLink, X } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { TMDB_API_TOKEN } from '@/lib/apiKeys';

interface Props {
  season: Season;
  moviePicks: MoviePick[];
  members: GroupMember[];
  profiles: Profile[];
  onUpdate: () => void;
}

interface TMDBMovie {
  id: number;
  title: string;
  poster_path: string | null;
  release_date: string;
  overview: string;
  vote_average: number;
  vote_count: number;
  genre_ids: number[];
  popularity: number;
}

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w200';
const TMDB_IMAGE_LG = 'https://image.tmdb.org/t/p/w500';

const getLetterboxdUrl = (title: string, year?: string) => {
  const q = encodeURIComponent(year ? `${title} ${year}` : title);
  return `https://letterboxd.com/search/${q}/`;
};

const MoviePickPhase = ({ season, moviePicks, members, profiles, onUpdate }: Props) => {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [results, setResults] = useState<TMDBMovie[]>([]);
  const [searchPage, setSearchPage] = useState(1);
  const [hasMoreResults, setHasMoreResults] = useState(false);
  const [lastSearchTerm, setLastSearchTerm] = useState('');
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<TMDBMovie | null>(null);
  const [director, setDirector] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [directorsMap, setDirectorsMap] = useState<Record<number, string>>({});
  const [constraints, setConstraints] = useState<Record<string, string>>({});

  const userPick = moviePicks.find(p => p.user_id === user?.id);
  const pickedCount = moviePicks.length;
  const totalMembers = members.length;
  const userConstraint = user ? constraints[user.id] : null;

  // Fetch participant constraints
  useEffect(() => {
    const fetchConstraints = async () => {
      const { data } = await supabase
        .from('season_participants')
        .select('user_id, pick_constraint')
        .eq('season_id', season.id);
      if (data) {
        const map: Record<string, string> = {};
        data.forEach(r => { if (r.pick_constraint) map[r.user_id] = r.pick_constraint; });
        setConstraints(map);
      }
    };
    fetchConstraints();
  }, [season.id]);

  // Fetch director when a movie is selected
  useEffect(() => {
    if (!selected) { setDirector(null); return; }
    const fetchDirector = async () => {
      try {
        const res = await fetch(
          `https://api.themoviedb.org/3/movie/${selected.id}/credits?language=en-US`,
          { headers: { 'Authorization': `Bearer ${TMDB_API_TOKEN}`, 'Accept': 'application/json' } }
        );
        const data = await res.json();
        const dir = data.crew?.find((c: { job: string; name: string }) => c.job === 'Director');
        setDirector(dir?.name || null);
      } catch { setDirector(null); }
    };
    fetchDirector();
  }, [selected]);

  const fetchDirectorsForMovies = async (movies: TMDBMovie[]) => {
    const idsToFetch = movies.filter(m => !directorsMap[m.id]).map(m => m.id);
    if (idsToFetch.length === 0) return;
    const entries = await Promise.all(
      idsToFetch.map(async (id) => {
        try {
          const res = await fetch(
            `https://api.themoviedb.org/3/movie/${id}/credits?language=en-US`,
            { headers: { 'Authorization': `Bearer ${TMDB_API_TOKEN}`, 'Accept': 'application/json' } }
          );
          const data = await res.json();
          const dir = data.crew?.find((c: { job: string; name: string }) => c.job === 'Director');
          return [id, dir?.name || ''] as const;
        } catch { return [id, ''] as const; }
      })
    );
    setDirectorsMap(prev => {
      const updated = { ...prev };
      entries.forEach(([id, name]) => { updated[id] = name; });
      return updated;
    });
  };

  const searchMovies = async (q?: string, page = 1) => {
    const term = q ?? query;
    if (!term.trim()) { setResults([]); setHasMoreResults(false); return; }
    if (!TMDB_API_TOKEN) {
      toast.error('TMDB API token is missing. Set VITE_TMDB_API_TOKEN and try again.');
      return;
    }
    setSearching(true);
    setSelected(null);
    try {
      const res = await fetch(
        `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(term)}&include_adult=false&language=en-US&page=${page}${yearFilter ? `&year=${yearFilter}` : ''}`,
        {
          headers: {
            'Authorization': `Bearer ${TMDB_API_TOKEN}`,
            'Accept': 'application/json',
          },
        }
      );
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`TMDB search failed (${res.status}). ${errText.slice(0, 200)}`);
      }
      const data = await res.json();
      const newResults = ((data.results || []) as TMDBMovie[]).sort((a, b) => {
        // Weight by vote_count (well-known films) and popularity
        const scoreA = (a.vote_count || 0) * 0.5 + (a.popularity || 0);
        const scoreB = (b.vote_count || 0) * 0.5 + (b.popularity || 0);
        return scoreB - scoreA;
      });
      if (page === 1) {
        setResults(newResults);
      } else {
        setResults(prev => [...prev, ...newResults]);
      }
      setSearchPage(page);
      setLastSearchTerm(term);
      setHasMoreResults(page < (data.total_pages || 1));
      // Fetch directors in background
      fetchDirectorsForMovies(newResults);
    } catch {
      toast.error('Failed to search movies');
    } finally {
      setSearching(false);
    }
  };

  const loadMoreResults = () => {
    if (hasMoreResults && !searching) {
      searchMovies(lastSearchTerm, searchPage + 1);
    }
  };

  // Auto-search as user types (debounced)
  useEffect(() => {
    if (!query.trim()) { setResults([]); setHasMoreResults(false); return; }
    const timer = setTimeout(() => searchMovies(query, 1), 350);
    return () => clearTimeout(timer);
  }, [query, yearFilter]);

  const pickMovie = async (movie: TMDBMovie) => {
    if (!user) return;
    setSubmitting(true);
    try {
      if (userPick) {
        // Update existing pick
        const { error } = await supabase.from('movie_picks').update({
          tmdb_id: movie.id,
          title: movie.title,
          poster_url: movie.poster_path ? `${TMDB_IMAGE_BASE}${movie.poster_path}` : null,
          year: movie.release_date?.split('-')[0] || null,
          overview: movie.overview || null,
        }).eq('id', userPick.id);
        if (error) throw error;
        toast.success(`Pick changed to "${movie.title}"!`);
      } else {
        const { error } = await supabase.from('movie_picks').insert({
          season_id: season.id,
          user_id: user.id,
          tmdb_id: movie.id,
          title: movie.title,
          poster_url: movie.poster_path ? `${TMDB_IMAGE_BASE}${movie.poster_path}` : null,
          year: movie.release_date?.split('-')[0] || null,
          overview: movie.overview || null,
        });
        if (error) throw error;
        toast.success(`"${movie.title}" picked!`);
      }
      setResults([]);
      setQuery('');
      setSelected(null);
      setEditing(false);
      onUpdate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save movie pick');
    } finally {
      setSubmitting(false);
    }
  };

  const removePick = async () => {
    if (!userPick || !user) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from('movie_picks').delete().eq('id', userPick.id);
      if (error) throw error;
      toast.success('Pick removed');
      setEditing(false);
      onUpdate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove pick');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="glass-card rounded-2xl p-4 sm:p-6 mt-4 sm:mt-6">
      {/* Prominent Season Theme */}
      {season.title && (
        <div className="mb-4 p-3 rounded-xl bg-primary/5 border border-primary/10 text-center">
          <p className="text-xs uppercase tracking-wider text-primary/70 mb-0.5">Season Theme</p>
          <h3 className="font-display text-lg sm:text-xl font-bold text-primary">{season.title}</h3>
        </div>
      )}
      <h2 className="font-display text-lg sm:text-xl font-bold mb-1">Pick Your Movie</h2>
      <p className="text-sm text-muted-foreground mb-3">
        {pickedCount} of {totalMembers} members have picked
      </p>

      {/* User's constraint callout */}
      {userConstraint && !userPick && (
        <div className="mb-3 p-2.5 rounded-lg bg-accent/10 border border-accent/20 text-center">
          <p className="text-xs uppercase tracking-wider text-accent-foreground/60 mb-0.5">Your Constraint</p>
          <p className="text-sm font-semibold text-accent-foreground">{userConstraint}</p>
        </div>
      )}

      {/* Member pick status */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {members.map((member) => {
          const profile = profiles.find(p => p.user_id === member.user_id);
          const hasPicked = moviePicks.some(p => p.user_id === member.user_id);
          const memberConstraint = constraints[member.user_id];
          const isOwnConstraint = user?.id === member.user_id;
          const showConstraint = memberConstraint && (isOwnConstraint || (season as any).constraints_visible !== false);
          return (
            <div
              key={member.id}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
                hasPicked ? 'bg-primary/10 text-primary' : 'bg-muted/20 text-muted-foreground'
              }`}
              title={memberConstraint ? `Constraint: ${memberConstraint}` : undefined}
            >
              {hasPicked ? <Check className="w-3 h-3" /> : <span className="w-3 h-3 rounded-full border border-current opacity-40" />}
              {profile?.display_name || 'Unknown'}
              {showConstraint && <span className="text-[10px] opacity-70">({memberConstraint})</span>}
            </div>
          );
        })}
      </div>

      {userPick && !editing ? (
        <div className="flex items-center gap-3 bg-primary/5 rounded-xl p-4">
          <Check className="w-5 h-5 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium">You picked: {userPick.title}</p>
            <p className="text-xs text-muted-foreground">Your pick is secret until revealed!</p>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              Change
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={submitting}>
                  Remove
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove your pick?</AlertDialogTitle>
                  <AlertDialogDescription>This will remove "{userPick.title}" as your pick. You can search and pick a new movie after.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={removePick} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for a movie..."
              className="bg-muted/50 border-border flex-1"
              onKeyDown={(e) => e.key === 'Enter' && searchMovies(undefined, 1)}
            />
            <Input
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="Year"
              className="bg-muted/50 border-border w-20"
            />
            <Button variant="gold" onClick={() => searchMovies(undefined, 1)} disabled={searching}>
              <Search className="w-4 h-4" />
            </Button>
          </div>

          {/* Expanded detail view */}
          {selected && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="flex flex-col sm:flex-row">
                {selected.poster_path ? (
                  <img
                    src={`${TMDB_IMAGE_LG}${selected.poster_path}`}
                    alt={selected.title}
                    className="w-full sm:w-48 aspect-[2/3] object-cover"
                  />
                ) : (
                  <div className="w-full sm:w-48 aspect-[2/3] bg-muted flex items-center justify-center">
                    <Film className="w-12 h-12 text-muted-foreground" />
                  </div>
                )}
                <div className="p-4 flex-1 flex flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-display text-lg font-bold">{selected.title}</h3>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm text-muted-foreground">{selected.release_date?.split('-')[0]}</p>
                        {director && (
                          <>
                            <span className="text-sm text-muted-foreground">·</span>
                            <p className="text-sm text-muted-foreground">Dir. {director}</p>
                          </>
                        )}
                      </div>
                    </div>
                    <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {selected.vote_average > 0 && (
                    <div className="flex items-center gap-1.5 mt-2">
                      <Star className="w-4 h-4 text-primary fill-primary" />
                      <span className="text-sm font-semibold">{selected.vote_average.toFixed(1)}</span>
                      <span className="text-xs text-muted-foreground">/ 10</span>
                      <span className="text-xs text-muted-foreground ml-1">({selected.vote_count.toLocaleString()} votes)</span>
                    </div>
                  )}

                  {selected.overview && (
                    <p className="text-sm text-muted-foreground mt-3 line-clamp-4">{selected.overview}</p>
                  )}

                  <div className="flex items-center gap-2 mt-auto pt-4">
                    <Button variant="gold" onClick={() => pickMovie(selected)} disabled={submitting} className="flex-1">
                      Pick This Movie
                    </Button>
                    <a
                      href={getLetterboxdUrl(selected.title, selected.release_date?.split('-')[0])}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors px-3 py-2 rounded-lg border border-border hover:border-primary/30"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Letterboxd
                    </a>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Grid results */}
          {results.length > 0 && !selected && (
            <div className="space-y-1 max-h-[400px] overflow-y-auto rounded-xl border border-border bg-card/50 p-1">
              {results.map((movie, idx) => (
                <button
                  key={`${movie.id}-${idx}`}
                  onClick={() => setSelected(movie)}
                  className="w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-primary/10 transition-colors"
                >
                  {movie.poster_path ? (
                    <img
                      src={`${TMDB_IMAGE_BASE}${movie.poster_path}`}
                      alt={movie.title}
                      className="w-8 h-12 rounded object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-8 h-12 rounded bg-muted flex items-center justify-center shrink-0">
                      <Film className="w-3 h-3 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{movie.title}</p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs text-muted-foreground">{movie.release_date?.split('-')[0]}</span>
                      {directorsMap[movie.id] && (
                        <span className="text-xs text-muted-foreground">· {directorsMap[movie.id]}</span>
                      )}
                      {movie.vote_average > 0 && (
                        <div className="flex items-center gap-0.5">
                          <Star className="w-2.5 h-2.5 text-primary fill-primary" />
                          <span className="text-[11px] text-muted-foreground">{movie.vote_average.toFixed(1)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              ))}
              {hasMoreResults && (
                <button
                  onClick={loadMoreResults}
                  disabled={searching}
                  className="w-full text-center text-sm text-primary hover:text-primary/80 py-2 font-medium"
                >
                  {searching ? 'Loading...' : 'Load more results'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MoviePickPhase;
