import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Season, MoviePick, Profile } from '@/hooks/useGroup';
import { Eye, EyeOff, Film, ChevronDown, ChevronUp, Clock, CalendarClock, Pencil, Trash2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

const CountdownTimer = ({ targetDate, isAdmin, onEdit, onDelete }: {
  targetDate: string;
  isAdmin: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) => {
  const [timeLeft, setTimeLeft] = useState('');
  const [isPast, setIsPast] = useState(false);

  useEffect(() => {
    const update = () => {
      const now = new Date().getTime();
      const target = new Date(targetDate).getTime();
      const diff = target - now;

      if (diff <= 0) {
        setTimeLeft('Time\'s up!');
        setIsPast(true);
        return;
      }

      setIsPast(false);
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      const parts: string[] = [];
      if (days > 0) parts.push(`${days}d`);
      parts.push(`${hours}h`);
      parts.push(`${String(minutes).padStart(2, '0')}m`);
      parts.push(`${String(seconds).padStart(2, '0')}s`);
      setTimeLeft(parts.join(' '));
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [targetDate]);

  const target = new Date(targetDate);

  return (
    <div className="glass-card rounded-2xl p-5 mt-6">
      <div className="flex items-start gap-4">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${isPast ? 'bg-destructive/10' : 'bg-primary/10'}`}>
          <CalendarClock className={`w-5 h-5 ${isPast ? 'text-destructive' : 'text-primary'}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground">Next call / Watch by</p>
          <p className={`font-display text-2xl font-bold tracking-wide ${isPast ? 'text-destructive' : 'text-primary'}`}>
            {timeLeft}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {target.toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
            {' at '}
            {target.toLocaleTimeString(undefined, {
              hour: 'numeric',
              minute: '2-digit',
            })}
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-1 shrink-0">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit}>
              <Pencil className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={onDelete}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

const CallDateEditor = ({ season, onSave, onCancel, initialDate }: {
  season: Season;
  onSave: () => void;
  onCancel: () => void;
  initialDate?: string;
}) => {
  const initial = initialDate ? new Date(initialDate) : new Date();
  const [date, setDate] = useState(
    `${initial.getFullYear()}-${String(initial.getMonth() + 1).padStart(2, '0')}-${String(initial.getDate()).padStart(2, '0')}`
  );
  const [time, setTime] = useState(
    `${String(initial.getHours()).padStart(2, '0')}:${String(initial.getMinutes()).padStart(2, '0')}`
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const dateTime = new Date(`${date}T${time}`);
    if (isNaN(dateTime.getTime())) {
      toast.error('Invalid date/time');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('seasons')
        .update({ next_call_date: dateTime.toISOString() })
        .eq('id', season.id);
      if (error) throw error;
      toast.success('Call date updated!');
      onSave();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="glass-card rounded-2xl p-5 mt-6 space-y-3">
      <div className="flex items-center gap-2">
        <CalendarClock className="w-4 h-4 text-primary" />
        <p className="text-sm font-medium">{initialDate ? 'Edit' : 'Set'} Next Call Date</p>
      </div>
      <div className="flex gap-2">
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="bg-muted/50 flex-1" />
        <Input type="time" value={time} onChange={e => setTime(e.target.value)} className="bg-muted/50 w-32" />
      </div>
      <div className="flex gap-2">
        <Button variant="gold" size="sm" onClick={handleSave} disabled={saving} className="flex-1">
          {saving ? 'Saving...' : 'Save'}
        </Button>
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
};

const WatchingPhase = ({ season, moviePicks, profiles, members, getProfile, isAdmin, onUpdate }: Props) => {
  const [showWatched, setShowWatched] = useState(false);
  const [editing, setEditing] = useState(false);
  const [posterOverrides, setPosterOverrides] = useState<Record<string, string>>({});
  const [directors, setDirectors] = useState<Record<string, string>>({});
  const sortedPicks = [...moviePicks].sort((a, b) => (a.watch_order ?? 0) - (b.watch_order ?? 0));

  // Auto-fetch posters and directors for movies
  useEffect(() => {
    const fetchMovieData = async () => {
      for (const pick of moviePicks) {
        try {
          let tmdbId = pick.tmdb_id;

          // Search if we need poster or don't have tmdb_id
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
                await supabase.from('movie_picks').update({
                  poster_url: url,
                  tmdb_id: movie.id,
                  overview: movie.overview || null,
                }).eq('id', pick.id);
              }
            }
          }

          // Fetch director
          if (tmdbId && !directors[pick.id]) {
            const creditsRes = await fetch(
              `https://api.themoviedb.org/3/movie/${tmdbId}/credits?language=en-US`,
              { headers: { 'Authorization': `Bearer ${TMDB_API_TOKEN}`, 'Accept': 'application/json' } }
            );
            const creditsData = await creditsRes.json();
            const director = creditsData.crew?.find((c: { job: string; name: string }) => c.job === 'Director');
            if (director) {
              setDirectors(prev => ({ ...prev, [pick.id]: director.name }));
            }
          }
        } catch {
          // silently skip
        }
      }
    };
    fetchMovieData();
  }, [moviePicks]);

  const watchedPicks = sortedPicks.filter((_, i) => i < season.current_movie_index);
  const currentAndUpcoming = sortedPicks.filter((_, i) => i >= season.current_movie_index);

  const handleDeleteCallDate = async () => {
    try {
      const { error } = await supabase
        .from('seasons')
        .update({ next_call_date: null })
        .eq('id', season.id);
      if (error) throw error;
      toast.success('Call date removed');
      onUpdate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove call date');
    }
  };

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

        {(pick.poster_url || posterOverrides[pick.id]) ? (
          <img src={pick.poster_url || posterOverrides[pick.id]} alt={pick.title} className="w-10 rounded-lg object-cover" />
        ) : (
          <div className="w-10 h-14 rounded-lg bg-muted flex items-center justify-center">
            <Film className="w-4 h-4 text-muted-foreground" />
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
          {!isWatched && (() => {
            // Get user_ids of members whose picks haven't been watched yet
            const unwatchedPicks = sortedPicks.filter((_, idx) => idx >= season.current_movie_index);
            const revealedPickerIds = sortedPicks
              .filter((_, idx) => idx < season.current_movie_index)
              .map(p => p.user_id);
            const remainingMembers = members
              .filter(m => !revealedPickerIds.includes(m.user_id))
              .map(m => getProfile(m.user_id)?.display_name)
              .filter(Boolean);
            
            return (
              <div className="flex flex-wrap items-center gap-1 mt-0.5">
                {remainingMembers.map((name, idx) => (
                  <span key={idx} className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/40 text-muted-foreground">
                    {name}
                  </span>
                ))}
              </div>
            );
          })()}
        </div>

        <div className="flex items-center gap-2">
          {!isWatched && (
            <div className={`flex items-center justify-center w-8 h-8 rounded-full ${
              isCurrent ? 'bg-primary/15' : 'bg-muted/30'
            }`}>
              <EyeOff className={`w-4 h-4 ${isCurrent ? 'text-primary' : 'text-muted-foreground/60'}`} />
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Countdown / Call Date */}
      {editing ? (
        <CallDateEditor
          season={season}
          initialDate={season.next_call_date || undefined}
          onSave={() => { setEditing(false); onUpdate(); }}
          onCancel={() => setEditing(false)}
        />
      ) : season.next_call_date ? (
        <CountdownTimer
          targetDate={season.next_call_date}
          isAdmin={isAdmin}
          onEdit={() => setEditing(true)}
          onDelete={handleDeleteCallDate}
        />
      ) : isAdmin ? (
        <div className="glass-card rounded-2xl p-5 mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CalendarClock className="w-5 h-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No call date set</p>
          </div>
          <Button variant="gold" size="sm" onClick={() => setEditing(true)}>
            <Plus className="w-4 h-4 mr-1" /> Set Call Date
          </Button>
        </div>
      ) : null}

      <div className="glass-card rounded-2xl p-6 mt-6">
        <h2 className="font-display text-xl font-bold mb-4">Watch Schedule</h2>

        <div className="space-y-3">
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
