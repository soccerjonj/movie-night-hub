import { Season, MoviePick, Profile } from '@/hooks/useGroup';
import { Calendar, Film, Eye } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

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

const SeasonStatus = ({ season, moviePicks, getProfile }: Props) => {
  const currentMovie = moviePicks.find((_, i) => i === season.current_movie_index);

  return (
    <div className="glass-card rounded-2xl p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-xl font-bold">Season {season.season_number}</h2>
        <span className="text-sm px-3 py-1 rounded-full bg-primary/10 text-primary font-medium">
          {statusLabels[season.status]}
        </span>
      </div>

      {season.status === 'watching' && currentMovie && (
        <div className="flex items-start gap-4 mt-4">
          {currentMovie.poster_url && (
            <img
              src={currentMovie.poster_url}
              alt={currentMovie.title}
              className="w-20 rounded-lg shadow-lg"
            />
          )}
          <div className="flex-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Now Watching</p>
            <h3 className="font-display text-lg font-bold">{currentMovie.title}</h3>
            {currentMovie.year && <p className="text-sm text-muted-foreground">{currentMovie.year}</p>}
            {currentMovie.revealed && (
              <p className="text-sm text-primary mt-1 flex items-center gap-1">
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
            {moviePicks.map((pick, i) => (
              <div
                key={pick.id}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  i < season.current_movie_index
                    ? 'bg-primary'
                    : i === season.current_movie_index
                    ? 'bg-primary/60'
                    : 'bg-muted'
                }`}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {season.current_movie_index + 1} of {moviePicks.length} movies
          </p>
        </div>
      )}
    </div>
  );
};

export default SeasonStatus;
