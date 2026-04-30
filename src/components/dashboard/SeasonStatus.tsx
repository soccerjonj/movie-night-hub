import { useState, useEffect } from 'react';
import { Season, MoviePick, Profile, Group } from '@/hooks/useGroup';
import { Calendar, Film, BookOpen, Eye, Video, ExternalLink, MapPin } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { ClubType, getClubLabels } from '@/lib/clubTypes';
import { TMDB_API_TOKEN } from '@/lib/apiKeys';
import { motion } from 'framer-motion';

interface Props {
  season: Season;
  moviePicks: MoviePick[];
  getProfile: (userId: string) => Profile | undefined;
  clubType: ClubType;
  group?: Group;
}

const TMDB_IMAGE_LG = 'https://image.tmdb.org/t/p/w500';

const SeasonStatus = ({ season, moviePicks, getProfile, clubType, group }: Props) => {
  const isInPerson = group?.meeting_type === 'in_person';
  const labels = getClubLabels(clubType);
  const ItemIcon = clubType === 'book' ? BookOpen : Film;
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [director, setDirector] = useState<string | null>(null);
  const [readingStatus, setReadingStatus] = useState<string | null>(null);

  const currentMovie = moviePicks.find(p => p.watch_order === season.current_movie_index);

  useEffect(() => {
    if (!currentMovie) return;
    if (currentMovie.poster_url) {
      setPosterUrl(currentMovie.poster_url);
    }

    const fetchTmdbData = async () => {
      try {
        let tmdbId = currentMovie.tmdb_id;

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

  useEffect(() => {
    const fetchReadingStatus = async () => {
      if (clubType !== 'book') {
        setReadingStatus(null);
        return;
      }
      try {
        const { data, error } = await supabase
          .from('reading_assignments')
          .select('chapter_range, start_page, end_page')
          .eq('season_id', season.id)
          .order('order_index', { ascending: true })
          .order('due_date', { ascending: true })
          .limit(1);
        if (error) throw error;
        const first = data?.[0];
        if (!first) { setReadingStatus('Chapters TBD'); return; }
        if (first.chapter_range) { setReadingStatus(`Chapters ${first.chapter_range}`); return; }
        if (first.start_page || first.end_page) {
          setReadingStatus(`Pages ${first.start_page ?? '?'}–${first.end_page ?? '?'}`);
          return;
        }
        setReadingStatus('Chapters TBD');
      } catch {
        setReadingStatus('Chapters TBD');
      }
    };
    fetchReadingStatus();
  }, [clubType, season.id]);

  const uniquePicks = moviePicks.filter((p, i, arr) => arr.findIndex(x => x.watch_order === p.watch_order) === i);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="glass-card rounded-2xl p-4 sm:p-6 mb-4 sm:mb-6"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <h2 className="font-display text-lg sm:text-xl font-bold">
          {labels.seasonNoun} {season.season_number}
          {season.title ? ` — ${season.title}` : ''}
        </h2>
        <span className={`text-xs sm:text-sm px-2.5 sm:px-3 py-1 rounded-full font-medium w-fit border ${
          season.status === 'watching'
            ? 'bg-primary/10 border-primary/25 text-primary'
            : 'bg-muted/30 border-border/50 text-muted-foreground'
        }`}>
          {season.status === 'watching'
            ? clubType === 'book'
              ? `Currently reading: ${readingStatus ?? 'Chapters TBD'}`
              : `Currently ${labels.watching}: ${labels.Item} ${season.current_movie_index + 1} of ${uniquePicks.length}`
            : labels.statusLabels[season.status]}
        </span>
      </div>

      {/* Movie club: cinematic Now Watching card */}
      {season.status === 'watching' && currentMovie && clubType !== 'book' && (
        <div className="relative overflow-hidden rounded-xl mt-2">
          {posterUrl && (
            <>
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage: `url(${posterUrl})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center top',
                  filter: 'blur(28px) saturate(1.4)',
                  transform: 'scale(1.15)',
                  opacity: 0.22,
                }}
              />
              <div className="absolute inset-0 cinematic-backdrop" />
              <div className="absolute inset-0 bg-gradient-to-t from-card/90 via-transparent to-transparent" />
            </>
          )}
          {!posterUrl && <div className="absolute inset-0 bg-muted/10 rounded-xl" />}

          <div className="relative flex items-start gap-4 sm:gap-5 p-4 sm:p-5">
            {/* Poster */}
            <div className="shrink-0">
              {posterUrl ? (
                <img
                  src={posterUrl}
                  alt={currentMovie.title}
                  className="w-24 sm:w-32 rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.6)] ring-1 ring-white/10"
                />
              ) : (
                <div className="w-24 sm:w-32 aspect-[2/3] rounded-xl bg-muted/30 flex items-center justify-center">
                  <ItemIcon className="w-8 h-8 text-muted-foreground/30" />
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0 py-1">
              {/* Pulsing NOW PLAYING indicator */}
              <div className="flex items-center gap-1.5 mb-2">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping-slow absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                </span>
                <p className="text-[10px] sm:text-[11px] text-primary uppercase tracking-[0.2em] font-bold">
                  {labels.nowAction}
                </p>
              </div>

              <h3 className="font-display text-xl sm:text-2xl font-bold leading-tight">{currentMovie.title}</h3>
              <div className="flex flex-wrap items-center gap-x-2 mt-1.5">
                {currentMovie.year && (
                  <span className="text-xs text-muted-foreground">{currentMovie.year}</span>
                )}
                {director && (
                  <>
                    <span className="text-muted-foreground/30">·</span>
                    <span className="text-xs text-muted-foreground">Directed by {director}</span>
                  </>
                )}
              </div>
              {currentMovie.overview && (
                <p className="text-xs sm:text-sm text-muted-foreground mt-2 leading-relaxed">
                  {currentMovie.overview}
                </p>
              )}
              {currentMovie.revealed && (currentMovie.watch_order ?? 0) < season.current_movie_index && (
                <p className="text-xs text-primary mt-2 flex items-center gap-1.5">
                  <Eye className="w-3 h-3" />
                  Picked by {getProfile(currentMovie.user_id)?.display_name}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Book club: compact cover + title */}
      {season.status === 'watching' && currentMovie && clubType === 'book' && (
        <div className="flex items-center gap-3 mt-4">
          {posterUrl ? (
            <img
              src={posterUrl}
              alt={currentMovie.title}
              className="w-12 sm:w-14 rounded-lg shadow-md ring-1 ring-border/20 shrink-0"
            />
          ) : (
            <div className="w-12 sm:w-14 aspect-[2/3] rounded-lg bg-muted/30 flex items-center justify-center shrink-0">
              <BookOpen className="w-5 h-5 text-muted-foreground/30" />
            </div>
          )}
          <div className="min-w-0">
            <h3 className="font-display text-base sm:text-lg font-bold truncate">{currentMovie.title}</h3>
            {currentMovie.year && <p className="text-xs text-muted-foreground">{currentMovie.year}</p>}
          </div>
        </div>
      )}

      {/* Next call / meeting info */}
      {season.next_call_date && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mt-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="w-4 h-4 shrink-0" />
            <span>
              Next {isInPerson ? 'meetup' : 'call'}: {format(new Date(season.next_call_date), 'EEEE, MMM d · h:mm a')}
              {' '}({formatDistanceToNow(new Date(season.next_call_date), { addSuffix: true })})
            </span>
          </div>
          {isInPerson && group?.meeting_location && (
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground bg-muted/30 px-3 py-1.5 rounded-full w-fit">
              <MapPin className="w-4 h-4 text-primary" />
              {group.meeting_location}
            </span>
          )}
          {!isInPerson && season.call_link && (
            <a
              href={season.call_link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors bg-primary/10 hover:bg-primary/15 px-3 py-1.5 rounded-full w-fit"
            >
              <Video className="w-4 h-4" />
              Join Call
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}

      {!season.next_call_date && !isInPerson && season.call_link && (
        <div className="mt-4">
          <a
            href={season.call_link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors bg-primary/10 hover:bg-primary/15 px-3 py-1.5 rounded-full w-fit"
          >
            <Video className="w-4 h-4" />
            Join Call
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}
      {!season.next_call_date && isInPerson && group?.meeting_location && (
        <div className="mt-4">
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground bg-muted/30 px-3 py-1.5 rounded-full w-fit">
            <MapPin className="w-4 h-4 text-primary" />
            {group.meeting_location}
          </span>
        </div>
      )}

      {/* Progress bar — movie clubs only */}
      {season.status === 'watching' && clubType !== 'book' && (
        <div className="mt-4">
          <div className="flex gap-1">
            {uniquePicks
              .sort((a, b) => (a.watch_order ?? 0) - (b.watch_order ?? 0))
              .map((pick) => {
                const state =
                  (pick.watch_order ?? 0) < season.current_movie_index ? 'done'
                  : (pick.watch_order ?? 0) === season.current_movie_index ? 'current'
                  : 'upcoming';
                return (
                  <div
                    key={pick.id}
                    className={`h-2 flex-1 rounded-full transition-all duration-500 ${
                      state === 'done' ? 'bg-primary'
                      : state === 'current' ? 'bg-primary/50'
                      : 'bg-muted/50'
                    }`}
                  />
                );
              })}
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            {season.current_movie_index + 1} of {uniquePicks.length} {labels.items}
          </p>
        </div>
      )}
    </motion.div>
  );
};

export default SeasonStatus;
