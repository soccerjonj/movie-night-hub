import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Season, MoviePick, Profile } from '@/hooks/useGroup';
import { Film, BookOpen, ChevronDown, ChevronUp, Check, X, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { TMDB_API_TOKEN } from '@/lib/apiKeys';
import { motion, AnimatePresence } from 'framer-motion';
import { ClubType, getClubLabels } from '@/lib/clubTypes';
import ReadingAssignments from './ReadingAssignments';
import MeetingScheduleManager from './MeetingScheduleManager';

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w200';

interface Props {
  season: Season;
  moviePicks: MoviePick[];
  profiles: Profile[];
  members: { user_id: string }[];
  getProfile: (userId: string) => Profile | undefined;
  isAdmin: boolean;
  onUpdate: () => void;
  clubType: ClubType;
  meetingType: 'remote' | 'in_person';
}

interface GuessRow {
  guesser_id: string;
  guessed_user_id: string;
  movie_pick_id: string;
}

interface ReadingAssignment {
  id: string;
  order_index: number;
  chapter_range: string | null;
  start_page: number | null;
  end_page: number | null;
  due_date: string | null;
  notes: string | null;
}

const WatchingPhase = ({ season, moviePicks, profiles, members, getProfile, isAdmin, onUpdate, clubType, meetingType }: Props) => {
  const labels = getClubLabels(clubType);
  const ItemIcon = clubType === 'book' ? BookOpen : Film;
  const { user } = useAuth();
  const [showWatched, setShowWatched] = useState(false);
  const [posterOverrides, setPosterOverrides] = useState<Record<string, string>>({});
  const [directors, setDirectors] = useState<Record<string, string>>({});
  const [userGuesses, setUserGuesses] = useState<Record<string, string>>({});
  const [allGuesses, setAllGuesses] = useState<GuessRow[]>([]);
  const [expandedPick, setExpandedPick] = useState<string | null>(null);
  const [readingAssignments, setReadingAssignments] = useState<ReadingAssignment[]>([]);
  const sortedPicks = [...moviePicks].sort((a, b) => (a.watch_order ?? 0) - (b.watch_order ?? 0));

  // Fetch current user's guesses
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

  // Fetch ALL guesses for the season (visible during watching/completed)
  useEffect(() => {
    const fetchAllGuesses = async () => {
      const { data } = await supabase
        .from('guesses')
        .select('guesser_id, guessed_user_id, movie_pick_id')
        .eq('season_id', season.id);
      if (data) setAllGuesses(data);
    };
    fetchAllGuesses();
  }, [season.id]);

  useEffect(() => {
    const fetchAssignments = async () => {
      if (clubType !== 'book') return;
      const { data } = await supabase
        .from('reading_assignments')
        .select('id, order_index, chapter_range, start_page, end_page, due_date, notes')
        .eq('season_id', season.id)
        .order('order_index', { ascending: true })
        .order('due_date', { ascending: true });
      setReadingAssignments((data || []) as ReadingAssignment[]);
    };
    fetchAssignments();
  }, [clubType, season.id]);

  // Fetch movie posters/directors
  useEffect(() => {
    const fetchMovieData = async () => {
      if (clubType === 'book') return;
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
  }, [moviePicks, clubType]);

  const watchedPicks = sortedPicks.filter((_, i) => i < season.current_movie_index);
  const currentAndUpcoming = sortedPicks.filter((_, i) => i >= season.current_movie_index);

  const sortedReadings = [...readingAssignments].sort((a, b) => a.order_index - b.order_index);
  const today = new Date();
  const currentReadingIndex = (() => {
    if (sortedReadings.length === 0) return -1;
    const idx = sortedReadings.findIndex((r) => {
      if (!r.due_date) return false;
      const due = new Date(`${r.due_date}T23:59:59`);
      return due >= today;
    });
    return idx >= 0 ? idx : sortedReadings.length - 1;
  })();
  const completedReadings = sortedReadings.filter((r, idx) => idx < currentReadingIndex);
  const currentAndUpcomingReadings = currentReadingIndex >= 0
    ? sortedReadings.filter((_, idx) => idx >= currentReadingIndex)
    : sortedReadings;

  const formatReadingRange = (reading: ReadingAssignment) => {
    const chapterText = reading.chapter_range ? `Chapters ${reading.chapter_range}` : null;
    const pageText = (reading.start_page || reading.end_page)
      ? `Pages ${reading.start_page ?? '?'}–${reading.end_page ?? '?'}`
      : null;
    if (chapterText && pageText) return `${chapterText} · ${pageText}`;
    return chapterText || pageText || 'Reading details TBD';
  };

  const getGuessesForPick = (pickId: string) => {
    return allGuesses.filter(g => g.movie_pick_id === pickId);
  };

  const renderGuessBreakdown = (pick: MoviePick, isWatched: boolean) => {
    const guesses = getGuessesForPick(pick.id);
    if (guesses.length === 0) {
      return (
        <p className="text-xs text-muted-foreground italic py-2">No guesses recorded</p>
      );
    }

    const correctCount = isWatched ? guesses.filter(g => g.guessed_user_id === pick.user_id).length : 0;
    const pct = isWatched ? Math.round((correctCount / guesses.length) * 100) : 0;

    return (
      <div className="space-y-1.5 py-2">
        {isWatched && (
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-medium text-primary">{correctCount}/{guesses.length} correct</span>
            <span className="text-xs text-muted-foreground">({pct}% accuracy)</span>
          </div>
        )}
        {guesses.map(g => {
          const guesserName = getProfile(g.guesser_id)?.display_name || 'Unknown';
          const guessedName = getProfile(g.guessed_user_id)?.display_name || 'Unknown';
          const isCorrect = isWatched && g.guessed_user_id === pick.user_id;
          const isWrong = isWatched && g.guessed_user_id !== pick.user_id;

          return (
            <div
              key={g.guesser_id}
              className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs ${
                isCorrect ? 'bg-green-500/10' : isWrong ? 'bg-destructive/5' : 'bg-muted/20'
              }`}
            >
              <span className="font-medium text-foreground">{guesserName}</span>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">guessed</span>
                <span className={`font-medium ${isCorrect ? 'text-green-400' : isWrong ? 'text-destructive' : 'text-foreground'}`}>
                  {guessedName}
                </span>
                {isCorrect && <Check className="w-3 h-3 text-green-400" />}
                {isWrong && <X className="w-3 h-3 text-destructive" />}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderPick = (pick: MoviePick, i: number) => {
    const isCurrent = i === season.current_movie_index;
    const isWatched = i < season.current_movie_index;
    const isExpanded = expandedPick === pick.id;

    return (
      <div key={pick.id}>
        <button
          onClick={() => setExpandedPick(isExpanded ? null : pick.id)}
          className={`w-full flex items-center gap-2 sm:gap-4 rounded-xl p-2 sm:p-3 transition-colors text-left ${
            isCurrent
              ? 'bg-primary/10 ring-1 ring-primary/30'
              : isWatched
              ? 'bg-muted/10 opacity-60 hover:opacity-80'
              : 'bg-muted/20 hover:bg-muted/30'
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
              <ItemIcon className="w-3 h-3 sm:w-4 sm:h-4 text-muted-foreground" />
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
        </button>

        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="ml-8 sm:ml-12 pl-2 sm:pl-4 border-l-2 border-border/30 mt-1 mb-2">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <Users className="w-3 h-3" />
                  <span>Everyone's guesses</span>
                </div>
                {renderGuessBreakdown(pick, isWatched)}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <>
      {clubType === 'book' && (
        <ReadingAssignments seasonId={season.id} isAdmin={isAdmin} />
      )}
      <MeetingScheduleManager seasonId={season.id} meetingType={meetingType} allowEdit={isAdmin} />

      {/* Movie schedule list - only for movie clubs */}
      {clubType !== 'book' && (
        <div className="glass-card rounded-2xl p-4 sm:p-6 mt-4 sm:mt-6">
          <h2 className="font-display text-lg sm:text-xl font-bold mb-3 sm:mb-4">{labels.scheduleLabel}</h2>
          <div className="space-y-2 sm:space-y-3">
            {watchedPicks.length > 0 && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowWatched(!showWatched)}
                  className="w-full justify-between text-muted-foreground hover:text-foreground"
                >
                  <span>{watchedPicks.length} already {labels.watched}</span>
                  {showWatched ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </Button>
                {showWatched && watchedPicks.map((pick) => renderPick(pick, sortedPicks.indexOf(pick)))}
              </>
            )}

            {currentAndUpcoming.map((pick) => renderPick(pick, sortedPicks.indexOf(pick)))}
          </div>
        </div>
      )}
    </>
  );
};

export default WatchingPhase;
