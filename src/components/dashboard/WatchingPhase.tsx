import { useState } from 'react';
import { Season, MoviePick, Profile } from '@/hooks/useGroup';
import { Eye, EyeOff, Film, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  season: Season;
  moviePicks: MoviePick[];
  getProfile: (userId: string) => Profile | undefined;
  isAdmin: boolean;
  onUpdate: () => void;
}

const WatchingPhase = ({ season, moviePicks, getProfile }: Props) => {
  const [showWatched, setShowWatched] = useState(false);
  const sortedPicks = [...moviePicks].sort((a, b) => (a.watch_order ?? 0) - (b.watch_order ?? 0));

  const watchedPicks = sortedPicks.filter((_, i) => i < season.current_movie_index);
  const currentAndUpcoming = sortedPicks.filter((_, i) => i >= season.current_movie_index);

  const renderPick = (pick: MoviePick, i: number) => {
    const isCurrent = i === season.current_movie_index;
    const isWatched = i < season.current_movie_index;

    return (
      <div
        key={pick.id}
        className={`flex items-center gap-4 rounded-xl p-3 transition-colors ${
          isCurrent
            ? 'bg-primary/10 ring-1 ring-primary/30'
            : isWatched
            ? 'bg-muted/10 opacity-60'
            : 'bg-muted/20'
        }`}
      >
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
          isCurrent ? 'bg-primary text-primary-foreground' : isWatched ? 'bg-muted text-muted-foreground' : 'bg-muted/50 text-muted-foreground'
        }`}>
          {i + 1}
        </div>

        {pick.poster_url ? (
          <img src={pick.poster_url} alt={pick.title} className="w-10 rounded-lg object-cover" />
        ) : (
          <div className="w-10 h-14 rounded-lg bg-muted flex items-center justify-center">
            <Film className="w-4 h-4 text-muted-foreground" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <p className={`font-medium text-sm truncate ${isCurrent ? 'text-foreground' : ''}`}>
            {pick.title}
          </p>
          {pick.year && <p className="text-xs text-muted-foreground">{pick.year}</p>}
        </div>

        <div className="flex items-center gap-2">
          {isWatched && pick.revealed ? (
            <span className="flex items-center gap-1 text-xs text-primary">
              <Eye className="w-3 h-3" />
              {getProfile(pick.user_id)?.display_name}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <EyeOff className="w-3 h-3" />
              {isWatched ? 'Hidden' : 'TBD'}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="glass-card rounded-2xl p-6 mt-6">
      <h2 className="font-display text-xl font-bold mb-4">Watch Schedule</h2>

      <div className="space-y-3">
        {/* Watched movies (collapsible) */}
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

        {/* Current + upcoming */}
        {currentAndUpcoming.map((pick) => renderPick(pick, sortedPicks.indexOf(pick)))}
      </div>
    </div>
  );
};

export default WatchingPhase;
