import { useState, useEffect } from 'react';
import { Season, MoviePick, Profile, Group } from '@/hooks/useGroup';
import { Calendar, Film, BookOpen, Eye, Video, ExternalLink, MapPin } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { ClubType, getClubLabels } from '@/lib/clubTypes';

interface Props {
  season: Season;
  moviePicks: MoviePick[];
  getProfile: (userId: string) => Profile | undefined;
  clubType: ClubType;
  group?: Group;
}

const TMDB_API_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJmNTY4MWM0OWEzYmQ0MTgwY2Y4NjliNWJiODU3NDFiZSIsIm5iZiI6MTc3MjY1ODEzNS4xNjIsInN1YiI6IjY5YTg5ZGQ3ZDcxNDhmYzc5OTk0NzE3ZSIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.OiO9ThN-gfA-HMEzrO52JlEQgg1njrMcVosXVcYlKKo';
const TMDB_IMAGE_LG = 'https://image.tmdb.org/t/p/w500';

const SeasonStatus = ({ season, moviePicks, getProfile, clubType }: Props) => {
  const labels = getClubLabels(clubType);
  const ItemIcon = clubType === 'book' ? BookOpen : Film;
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
    <div className="glass-card rounded-2xl p-4 sm:p-6 mb-4 sm:mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <h2 className="font-display text-lg sm:text-xl font-bold">
          Season {season.season_number}
          {season.title ? ` — ${season.title}` : ''}
        </h2>
        <span className="text-xs sm:text-sm px-2.5 sm:px-3 py-1 rounded-full bg-primary/10 text-primary font-medium w-fit">
          {season.status === 'watching'
            ? `Currently ${labels.watching}: Season ${season.season_number}, Episode ${season.current_movie_index + 1}`
            : labels.statusLabels[season.status]}
        </span>
      </div>

      {season.status === 'watching' && currentMovie && (
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-5 mt-4">
          <div className="flex flex-row sm:flex-col items-start gap-3 sm:gap-0 w-full sm:w-auto">
            {posterUrl ? (
              <img
                src={posterUrl}
                alt={currentMovie.title}
                className="w-36 sm:w-44 rounded-xl shadow-xl ring-1 ring-border/20 shrink-0"
              />
            ) : (
              <div className="w-36 sm:w-44 aspect-[2/3] rounded-xl bg-muted/30 flex items-center justify-center shrink-0">
                <ItemIcon className="w-8 h-8 sm:w-10 sm:h-10 text-muted-foreground/30" />
              </div>
            )}
            {/* Title + year next to poster on mobile, hidden on desktop */}
            <div className="sm:hidden flex-1 min-w-0">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{labels.nowAction}</p>
              <h3 className="font-display text-lg font-bold">{currentMovie.title}</h3>
              {currentMovie.year && <p className="text-xs text-muted-foreground mt-0.5">{currentMovie.year}</p>}
              {director && <p className="text-xs text-muted-foreground mt-0.5">Directed by {director}</p>}
              {currentMovie.revealed && (currentMovie.watch_order ?? 0) < season.current_movie_index && (
                <p className="text-xs text-primary mt-1 flex items-center gap-1">
                  <Eye className="w-3 h-3" />
                  Picked by {getProfile(currentMovie.user_id)?.display_name}
                </p>
              )}
            </div>
          </div>
          {/* Description below poster row on mobile */}
          {currentMovie.overview && (
            <p className="text-xs text-muted-foreground sm:hidden">{currentMovie.overview}</p>
          )}
          {/* Desktop layout */}
          <div className="flex-1 hidden sm:block text-left">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{labels.nowAction}</p>
            <h3 className="font-display text-2xl font-bold">{currentMovie.title}</h3>
            {currentMovie.year && <p className="text-sm text-muted-foreground mt-0.5">{currentMovie.year}</p>}
            {director && <p className="text-sm text-muted-foreground mt-0.5">Directed by {director}</p>}
            {currentMovie.overview && (
              <p className="text-sm text-muted-foreground mt-2 line-clamp-3">{currentMovie.overview}</p>
            )}
            {currentMovie.revealed && (currentMovie.watch_order ?? 0) < season.current_movie_index && (
              <p className="text-sm text-primary mt-2 flex items-center gap-1">
                <Eye className="w-3 h-3" />
                Picked by {getProfile(currentMovie.user_id)?.display_name}
              </p>
            )}
          </div>
        </div>
      )}

      {season.next_call_date && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mt-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="w-4 h-4" />
            <span>
              Next call: {format(new Date(season.next_call_date), 'EEEE, MMM d · h:mm a')}
              {' '}({formatDistanceToNow(new Date(season.next_call_date), { addSuffix: true })})
            </span>
          </div>
          {season.call_link && (
            <a
              href={season.call_link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors bg-primary/10 px-3 py-1.5 rounded-full w-fit"
            >
              <Video className="w-4 h-4" />
              Join Call
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}

      {!season.next_call_date && season.call_link && (
        <div className="mt-4">
          <a
            href={season.call_link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors bg-primary/10 px-3 py-1.5 rounded-full w-fit"
          >
            <Video className="w-4 h-4" />
            Join Call
            <ExternalLink className="w-3 h-3" />
          </a>
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
            {season.current_movie_index + 1} of {moviePicks.filter((p, i, arr) => arr.findIndex(x => x.watch_order === p.watch_order) === i).length} {labels.items}
          </p>
        </div>
      )}
    </div>
  );
};

export default SeasonStatus;
