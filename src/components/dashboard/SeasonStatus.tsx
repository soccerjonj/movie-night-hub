import { useState, useEffect } from 'react';
import { Season, MoviePick, Profile } from '@/hooks/useGroup';
import { Calendar, Film, Eye } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  season: Season;
  moviePicks: MoviePick[];
  getProfile: (userId: string) => Profile | undefined;
}

const statusLabels: Record<string, string> = {
  picking: '🎬 Picking Movies',
  guessing: '🔮 Guessing Round',
  watching: '🍿 Watching Season',
  completed: '✅ Season Complete',
};

const TMDB_API_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJmNTY4MWM0OWEzYmQ0MTgwY2Y4NjliNWJiODU3NDFiZSIsIm5iZiI6MTc3MjY1ODEzNS4xNjIsInN1YiI6IjY5YTg5ZGQ3ZDcxNDhmYzc5OTk0NzE3ZSIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.OiO9ThN-gfA-HMEzrO52JlEQgg1njrMcVosXVcYlKKo';
const TMDB_IMAGE_LG = 'https://image.tmdb.org/t/p/w500';

const SeasonStatus = ({ season, moviePicks, getProfile }: Props) => {
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [director, setDirector] = useState<string | null>(null);

  // Find current movie by watch_order matching the index
  const currentMovie = moviePicks.find(p => p.watch_order === season.current_movie_index);

  // Auto-fetch poster + director from TMDB if not stored
  useEffect(() => {
    if (!currentMovie) return;
    if (currentMovie.poster_url) {
      setPosterUrl(currentMovie.poster_url);
    }

    const fetchTmdbData = async () => {
      try {
        let tmdbId = currentMovie.tmdb_id;

        // Search for movie if we don't have tmdb_id
        if (!tmdbId || !currentMovie.poster_url) {
          const yearParam = currentMovie.year ? `&year=${currentMovie.year}` : '';
          const res = await fetch(
            `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(currentMovie.title)}&include_adult=false&language=en-US&page=1${yearParam}`,
            { headers: { 'Authorization': `Bearer ${TMDB_API_TOKEN}`, 'Accept': 'application/json' } }
          );
          const data = await res.json();
          const movie = data.results?.[0];
          if (movie) {
            tmdbId = movie.id;
            if (movie.poster_path && !currentMovie.poster_url) {
              const url = `${TMDB_IMAGE_LG}${movie.poster_path}`;
              setPosterUrl(url);
              await supabase.from('movie_picks').update({
                poster_url: url,
                tmdb_id: movie.id,
                overview: movie.overview || null,
              }).eq('id', currentMovie.id);
            }
          }
        }

        // Fetch director from credits
        if (tmdbId) {
          const creditsRes = await fetch(
            `https://api.themoviedb.org/3/movie/${tmdbId}/credits?language=en-US`,
            { headers: { 'Authorization': `Bearer ${TMDB_API_TOKEN}`, 'Accept': 'application/json' } }
          );
          const creditsData = await creditsRes.json();
          const directors = creditsData.crew?.filter((c: { job: string; name: string }) => c.job === 'Director');
          if (directors?.length) {
            setDirector(directors.map((d: { name: string }) => d.name).join(', '));
          }
        }
      } catch {
        // silently fail
      }
    };
    fetchTmdbData();
  }, [currentMovie?.id, currentMovie?.poster_url]);

  return (
    <div className="glass-card rounded-2xl p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-xl font-bold">
          Season {season.season_number}
          {season.title ? ` — ${season.title}` : ''}
        </h2>
        <span className="text-sm px-3 py-1 rounded-full bg-primary/10 text-primary font-medium">
          {statusLabels[season.status]}
        </span>
      </div>

      {season.status === 'watching' && currentMovie && (
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5 mt-4">
          {posterUrl ? (
            <img
              src={posterUrl}
              alt={currentMovie.title}
              className="w-36 sm:w-44 rounded-xl shadow-xl ring-1 ring-border/20"
            />
          ) : (
            <div className="w-36 sm:w-44 aspect-[2/3] rounded-xl bg-muted/30 flex items-center justify-center">
              <Film className="w-10 h-10 text-muted-foreground/30" />
            </div>
          )}
          <div className="flex-1 text-center sm:text-left">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Now Watching</p>
            <h3 className="font-display text-2xl font-bold">{currentMovie.title}</h3>
            {currentMovie.year && <p className="text-sm text-muted-foreground mt-0.5">{currentMovie.year}</p>}
            {director && <p className="text-sm text-muted-foreground mt-0.5">Directed by {director}</p>}
            {currentMovie.overview && (
              <p className="text-sm text-muted-foreground mt-2 line-clamp-3">{currentMovie.overview}</p>
            )}
            {currentMovie.revealed && (
              <p className="text-sm text-primary mt-2 flex items-center gap-1 justify-center sm:justify-start">
                <Eye className="w-3 h-3" />
                Picked by {getProfile(currentMovie.user_id)?.display_name}
              </p>
            )}
          </div>
        </div>
      )}

      {season.next_call_date && (
        <div className="flex items-center gap-2 mt-4 text-sm text-muted-foreground">
          <Calendar className="w-4 h-4" />
          <span>
            Next call: {format(new Date(season.next_call_date), 'EEEE, MMM d · h:mm a')}
            {' '}({formatDistanceToNow(new Date(season.next_call_date), { addSuffix: true })})
          </span>
        </div>
      )}

      {season.status === 'watching' && (
        <div className="mt-4">
          <div className="flex gap-1">
            {moviePicks
              .filter((p, i, arr) => arr.findIndex(x => x.watch_order === p.watch_order) === i)
              .sort((a, b) => (a.watch_order ?? 0) - (b.watch_order ?? 0))
              .map((pick) => (
                <div
                  key={pick.id}
                  className={`h-1.5 flex-1 rounded-full transition-colors ${
                    (pick.watch_order ?? 0) < season.current_movie_index
                      ? 'bg-primary'
                      : (pick.watch_order ?? 0) === season.current_movie_index
                      ? 'bg-primary/60'
                      : 'bg-muted'
                  }`}
                />
              ))}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {season.current_movie_index + 1} of {moviePicks.filter((p, i, arr) => arr.findIndex(x => x.watch_order === p.watch_order) === i).length} movies
          </p>
        </div>
      )}
    </div>
  );
};

export default SeasonStatus;
