import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Season, MoviePick, GroupMember } from '@/hooks/useGroup';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Check, Film, Star, ExternalLink, X } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  season: Season;
  moviePicks: MoviePick[];
  members: GroupMember[];
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
}

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w200';
const TMDB_IMAGE_LG = 'https://image.tmdb.org/t/p/w500';

const getLetterboxdUrl = (title: string, year?: string) => {
  const q = encodeURIComponent(year ? `${title} ${year}` : title);
  return `https://letterboxd.com/search/${q}/`;
};

const TMDB_API_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJmNTY4MWM0OWEzYmQ0MTgwY2Y4NjliNWJiODU3NDFiZSIsIm5iZiI6MTc3MjY1ODEzNS4xNjIsInN1YiI6IjY5YTg5ZGQ3ZDcxNDhmYzc5OTk0NzE3ZSIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.OiO9ThN-gfA-HMEzrO52JlEQgg1njrMcVosXVcYlKKo';

const MoviePickPhase = ({ season, moviePicks, members, onUpdate }: Props) => {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TMDBMovie[]>([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<TMDBMovie | null>(null);
  const [director, setDirector] = useState<string | null>(null);

  const userPick = moviePicks.find(p => p.user_id === user?.id);
  const pickedCount = moviePicks.length;
  const totalMembers = members.length;

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

  const searchMovies = async (q?: string) => {
    const term = q ?? query;
    if (!term.trim()) { setResults([]); return; }
    setSearching(true);
    setSelected(null);
    try {
      const res = await fetch(
        `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(term)}&include_adult=false&language=en-US&page=1`,
        {
          headers: {
            'Authorization': `Bearer ${TMDB_API_TOKEN}`,
            'Accept': 'application/json',
          },
        }
      );
      const data = await res.json();
      setResults(data.results?.slice(0, 8) || []);
    } catch {
      toast.error('Failed to search movies');
    } finally {
      setSearching(false);
    }
  };

  // Auto-search as user types (debounced)
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const timer = setTimeout(() => searchMovies(query), 350);
    return () => clearTimeout(timer);
  }, [query]);

  const pickMovie = async (movie: TMDBMovie) => {
    if (!user) return;
    setSubmitting(true);
    try {
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
      setResults([]);
      setQuery('');
      setSelected(null);
      onUpdate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save movie pick');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="glass-card rounded-2xl p-4 sm:p-6 mt-4 sm:mt-6">
      <h2 className="font-display text-lg sm:text-xl font-bold mb-1">Pick Your Movie</h2>
      <p className="text-sm text-muted-foreground mb-4">
        {pickedCount} of {totalMembers} members have picked
      </p>

      {userPick ? (
        <div className="flex items-center gap-3 bg-primary/5 rounded-xl p-4">
          <Check className="w-5 h-5 text-primary" />
          <div>
            <p className="font-medium">You picked: {userPick.title}</p>
            <p className="text-xs text-muted-foreground">Your pick is secret until revealed!</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for a movie..."
              className="bg-muted/50 border-border"
              onKeyDown={(e) => e.key === 'Enter' && searchMovies()}
            />
            <Button variant="gold" onClick={searchMovies} disabled={searching}>
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {results.map((movie) => (
                <button
                  key={movie.id}
                  onClick={() => setSelected(movie)}
                  className="text-left bg-muted/30 rounded-xl overflow-hidden hover:ring-2 hover:ring-primary/50 transition-all group"
                >
                  {movie.poster_path ? (
                    <img
                      src={`${TMDB_IMAGE_BASE}${movie.poster_path}`}
                      alt={movie.title}
                      className="w-full aspect-[2/3] object-cover"
                    />
                  ) : (
                    <div className="w-full aspect-[2/3] bg-muted flex items-center justify-center">
                      <Film className="w-8 h-8 text-muted-foreground" />
                    </div>
                  )}
                  <div className="p-2">
                    <p className="text-sm font-medium truncate">{movie.title}</p>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">{movie.release_date?.split('-')[0]}</p>
                      {movie.vote_average > 0 && (
                        <div className="flex items-center gap-0.5">
                          <Star className="w-3 h-3 text-primary fill-primary" />
                          <span className="text-xs font-medium">{movie.vote_average.toFixed(1)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MoviePickPhase;
