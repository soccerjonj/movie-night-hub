import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Season, MoviePick, Profile } from '@/hooks/useGroup';
import { Film, ChevronDown, ChevronUp, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const TMDB_API_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJmNTY4MWM0OWEzYmQ0MTgwY2Y4NjliNWJiODU3NDFiZSIsIm5iZiI6MTc3MjY1ODEzNS4xNjIsInN1YiI6IjY5YTg5ZGQ3ZDcxNDhmYzc5OTk0NzE3ZSIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.OiO9ThN-gfA-HMEzrO52JlEQgg1njrMcVosXVcYlKKo';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w200';

interface Props {
  season: Season;
  moviePicks: MoviePick[];
  profiles: Profile[];
  members: { user_id: string }[];
  getProfile: (userId: string) => Profile | undefined;
  isAdmin: boolean;
  onUpdate: () => void;
}
const WatchingPhase = ({ season, moviePicks, profiles, members, getProfile, isAdmin, onUpdate }: Props) => {
  const { user } = useAuth();
  const [showWatched, setShowWatched] = useState(false);
  const [posterOverrides, setPosterOverrides] = useState<Record<string, string>>({});
  const [directors, setDirectors] = useState<Record<string, string>>({});
  const [userGuesses, setUserGuesses] = useState<Record<string, string>>({});
  const sortedPicks = [...moviePicks].sort((a, b) => (a.watch_order ?? 0) - (b.watch_order ?? 0));

  useEffect(() => {
    const fetchGuesses = async () => {
      if (!user) return;
      const { data } = await supabase
        .from('guesses')
        .select('movie_pick_id, guessed_user_id')
        .eq('season_id', season.id)
        .eq('guesser_id', user.id);
      if (data) {
        const map: Record<string, string> = {};
        data.forEach(g => { map[g.movie_pick_id] = g.guessed_user_id; });
        setUserGuesses(map);
      }
    };
    fetchGuesses();
  }, [season.id, user]);

  useEffect(() => {
    const fetchMovieData = async () => {
      for (const pick of moviePicks) {
        try {
          let tmdbId = pick.tmdb_id;
          if (!tmdbId || !pick.poster_url) {
            const yearParam = pick.year ? `&year=${pick.year}` : '';
            const res = await fetch(
              `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(pick.title)}&include_adult=false&language=en-US&page=1${yearParam}`,
              { headers: { 'Authorization': `Bearer ${TMDB_API_TOKEN}`, 'Accept': 'application/json' } }
            );
            const data = await res.json();
            const movie = data.results?.[0];
            if (movie) {
              tmdbId = movie.id;
              if (movie.poster_path && !pick.poster_url) {
                const url = `${TMDB_IMAGE_BASE}${movie.poster_path}`;
                setPosterOverrides(prev => ({ ...prev, [pick.id]: url }));
                await supabase.from('movie_picks').update({ poster_url: url, tmdb_id: movie.id, overview: movie.overview || null }).eq('id', pick.id);
              }
            }
          }
          if (tmdbId && !directors[pick.id]) {
            const creditsRes = await fetch(
              `https://api.themoviedb.org/3/movie/${tmdbId}/credits?language=en-US`,
              { headers: { 'Authorization': `Bearer ${TMDB_API_TOKEN}`, 'Accept': 'application/json' } }
            );
            const creditsData = await creditsRes.json();
            const director = creditsData.crew?.find((c: { job: string; name: string }) => c.job === 'Director');
            if (director) setDirectors(prev => ({ ...prev, [pick.id]: director.name }));
          }
        } catch { /* skip */ }
      }
    };
    fetchMovieData();
  }, [moviePicks]);

  const watchedPicks = sortedPicks.filter((_, i) => i < season.current_movie_index);
  const currentAndUpcoming = sortedPicks.filter((_, i) => i >= season.current_movie_index);

  const renderPick = (pick: MoviePick, i: number) => {
    const isCurrent = i === season.current_movie_index;
    const isWatched = i < season.current_movie_index;

    return (
      <div
        key={pick.id}
        className={`flex items-center gap-2 sm:gap-4 rounded-xl p-2 sm:p-3 transition-colors ${
          isCurrent
            ? 'bg-primary/10 ring-1 ring-primary/30'
            : isWatched
            ? 'bg-muted/10 opacity-60'
            : 'bg-muted/20'
        }`}
      >
        <div className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold shrink-0 ${
          isCurrent ? 'bg-primary text-primary-foreground' : isWatched ? 'bg-muted text-muted-foreground' : 'bg-muted/50 text-muted-foreground'
        }`}>
          {i + 1}
        </div>

        {(pick.poster_url || posterOverrides[pick.id]) ? (
          <img src={pick.poster_url || posterOverrides[pick.id]} alt={pick.title} className="w-8 sm:w-10 rounded-lg object-cover shrink-0" />
        ) : (
          <div className="w-8 sm:w-10 h-11 sm:h-14 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <Film className="w-3 h-3 sm:w-4 sm:h-4 text-muted-foreground" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <p className={`font-medium text-sm truncate ${isCurrent ? 'text-foreground' : ''}`}>
            {pick.title}
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0">
            {pick.year && <span className="text-xs text-muted-foreground">{pick.year}</span>}
            {directors[pick.id] && (
              <>
                {pick.year && <span className="text-xs text-muted-foreground">·</span>}
                <span className="text-xs text-muted-foreground">{directors[pick.id]}</span>
              </>
            )}
          </div>
          {isWatched && (
            <span className="text-xs text-primary">
              Picked by {getProfile(pick.user_id)?.display_name}
            </span>
          )}
        </div>

        <div className="flex items-center shrink-0">
          {(() => {
            const guessedUserId = userGuesses[pick.id];
            const guessedName = guessedUserId ? getProfile(guessedUserId)?.display_name : null;

            if (isWatched && guessedName) {
              const isCorrect = guessedUserId === pick.user_id;
              return (
                <div className="text-right">
                  <span className="text-[10px] text-muted-foreground block">Your guess:</span>
                  <div className={`flex items-center gap-1 text-xs font-medium ${isCorrect ? 'text-green-400' : 'text-destructive'}`}>
                    {isCorrect ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    {guessedName}
                  </div>
                </div>
              );
            }

            if (!isWatched && guessedName) {
              return (
                <div className="text-right">
                  <span className="text-[10px] text-muted-foreground block">Your guess:</span>
                  <span className="text-xs font-medium text-primary">{guessedName}</span>
                </div>
              );
            }

            if (!isWatched && !guessedName) {
              const isYourPick = pick.user_id === user?.id;
              return isYourPick ? (
                <span className="text-[10px] text-primary/70 italic">Your pick</span>
              ) : (
                <span className="text-[10px] text-muted-foreground/50 italic">No guess</span>
              );
            }

            return null;
          })()}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="glass-card rounded-2xl p-4 sm:p-6 mt-4 sm:mt-6">
        <h2 className="font-display text-lg sm:text-xl font-bold mb-3 sm:mb-4">Watch Schedule</h2>

        <div className="space-y-2 sm:space-y-3">
          {watchedPicks.length > 0 && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowWatched(!showWatched)}
                className="w-full justify-between text-muted-foreground hover:text-foreground"
              >
                <span>{watchedPicks.length} already watched</span>
                {showWatched ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </Button>
              {showWatched && watchedPicks.map((pick) => renderPick(pick, sortedPicks.indexOf(pick)))}
            </>
          )}

          {currentAndUpcoming.map((pick) => renderPick(pick, sortedPicks.indexOf(pick)))}
        </div>
      </div>
    </>
  );
};

export default WatchingPhase;
