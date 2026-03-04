import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Season, MoviePick, GroupMember } from '@/hooks/useGroup';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Check, Film } from 'lucide-react';
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
}

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w200';

const MoviePickPhase = ({ season, moviePicks, members, onUpdate }: Props) => {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TMDBMovie[]>([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const userPick = moviePicks.find(p => p.user_id === user?.id);
  const pickedCount = moviePicks.length;
  const totalMembers = members.length;

  const searchMovies = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      // Use TMDB API directly (public usage for search)
      const res = await fetch(
        `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(query)}&include_adult=false&language=en-US&page=1`,
        {
          headers: {
            'Authorization': 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI0YjYyZmI2ZmI0NTRiODFiNjU2MjkzZTIwMjI0Njg2NiIsIm5iZiI6MTc0OTA1MDQ5NC4wNjgsInN1YiI6IjY4NDEyNTQ2MDEzMWI0Y2I4YWFkNTZhMiIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.0R-GO8fzHb7bsFqkGYBWoHY5oX6M-h_JOjBlyg1pUjI',
            'Accept': 'application/json',
          },
        }
      );
      const data = await res.json();
      setResults(data.results?.slice(0, 6) || []);
    } catch {
      toast.error('Failed to search movies');
    } finally {
      setSearching(false);
    }
  };

  const pickMovie = async (movie: TMDBMovie) => {
    if (!user) return;
    setSubmitting(true);
    try {
      await supabase.from('movie_picks').insert({
        season_id: season.id,
        user_id: user.id,
        tmdb_id: movie.id,
        title: movie.title,
        poster_url: movie.poster_path ? `${TMDB_IMAGE_BASE}${movie.poster_path}` : null,
        year: movie.release_date?.split('-')[0] || null,
        overview: movie.overview || null,
      });
      toast.success(`"${movie.title}" picked!`);
      setResults([]);
      setQuery('');
      onUpdate();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="glass-card rounded-2xl p-6 mt-6">
      <h2 className="font-display text-xl font-bold mb-1">Pick Your Movie</h2>
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

          {results.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {results.map((movie) => (
                <button
                  key={movie.id}
                  onClick={() => pickMovie(movie)}
                  disabled={submitting}
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
                    <p className="text-xs text-muted-foreground">{movie.release_date?.split('-')[0]}</p>
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
