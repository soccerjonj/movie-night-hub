import { useState, useEffect } from 'react';
import { Season, MoviePick, Profile, Group } from '@/hooks/useGroup';
import { BookOpen, Eye, Video, ExternalLink, MapPin, ChevronDown, ChevronUp, User, Share2 } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { ClubType, getClubLabels } from '@/lib/clubTypes';
import { TMDB_API_TOKEN } from '@/lib/apiKeys';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useShare } from '@/hooks/useShare';

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
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [backdropUrl, setBackdropUrl] = useState<string | null>(null);
  const [director, setDirector] = useState<string | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [readingStatus, setReadingStatus] = useState<string | null>(null);
  const [overviewExpanded, setOverviewExpanded] = useState(false);

  const currentMovie = moviePicks.find(p => p.watch_order === season.current_movie_index);

  // Call timing
  const callDate = season.next_call_date ? new Date(season.next_call_date) : null;
  const now = new Date();
  const diffMs = callDate ? callDate.getTime() - now.getTime() : null;
  const callIsToday = diffMs != null && diffMs > 0 && diffMs < 24 * 60 * 60 * 1000;
  const callIsTomorrow = diffMs != null && diffMs >= 24 * 60 * 60 * 1000 && diffMs < 48 * 60 * 60 * 1000;
  const callIsFuture = diffMs != null && diffMs > 0;
  const callSoon = callIsToday || callIsTomorrow;

  useEffect(() => {
    if (!currentMovie) return;
    if (currentMovie.poster_url) setPosterUrl(currentMovie.poster_url);

    const fetchTmdbData = async () => {
      try {
        let tmdbId = currentMovie.tmdb_id;
        if (!tmdbId || !currentMovie.poster_url) {
          const yearParam = currentMovie.year ? `&year=${currentMovie.year}` : '';
          const res = await fetch(
            `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(currentMovie.title)}&include_adult=false&language=en-US&page=1${yearParam}`,
            { headers: { Authorization: `Bearer ${TMDB_API_TOKEN}`, Accept: 'application/json' } }
          );
          const data = await res.json();
          const movie = data.results?.[0];
          if (movie) {
            tmdbId = movie.id;
            if (movie.poster_path && !currentMovie.poster_url) {
              const url = `${TMDB_IMAGE_LG}${movie.poster_path}`;
              setPosterUrl(url);
              await supabase.from('movie_picks').update({ poster_url: url, tmdb_id: movie.id, overview: movie.overview || null }).eq('id', currentMovie.id);
            }
          }
        }
        if (tmdbId) {
          const [detailsRes, creditsRes, imagesRes] = await Promise.all([
            fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?language=en-US`, { headers: { Authorization: `Bearer ${TMDB_API_TOKEN}`, Accept: 'application/json' } }),
            fetch(`https://api.themoviedb.org/3/movie/${tmdbId}/credits?language=en-US`, { headers: { Authorization: `Bearer ${TMDB_API_TOKEN}`, Accept: 'application/json' } }),
            fetch(`https://api.themoviedb.org/3/movie/${tmdbId}/images`, { headers: { Authorization: `Bearer ${TMDB_API_TOKEN}`, Accept: 'application/json' } }),
          ]);
          const [details, credits, images] = await Promise.all([detailsRes.json(), creditsRes.json(), imagesRes.json()]);
          if (typeof details.vote_average === 'number' && details.vote_average > 0) setRating(details.vote_average);
          const dirs = credits.crew?.filter((c: { job: string }) => c.job === 'Director');
          if (dirs?.length) setDirector(dirs.map((d: { name: string }) => d.name).join(', '));
          const topBackdrop = (images.backdrops || [])
            .sort((a: { vote_average: number }, b: { vote_average: number }) => b.vote_average - a.vote_average)[0];
          if (topBackdrop?.file_path) setBackdropUrl(`https://image.tmdb.org/t/p/w1280${topBackdrop.file_path}`);
        }
      } catch { /* silently fail */ }
    };
    fetchTmdbData();
  }, [currentMovie?.id, currentMovie?.poster_url]);

  useEffect(() => {
    const fetchReadingStatus = async () => {
      if (clubType !== 'book') { setReadingStatus(null); return; }
      try {
        const { data } = await supabase
          .from('reading_assignments').select('chapter_range, start_page, end_page')
          .eq('season_id', season.id).order('order_index', { ascending: true }).order('due_date', { ascending: true }).limit(1);
        const first = data?.[0];
        if (!first) { setReadingStatus('Chapters TBD'); return; }
        if (first.chapter_range) { setReadingStatus(`Chapters ${first.chapter_range}`); return; }
        if (first.start_page || first.end_page) { setReadingStatus(`Pages ${first.start_page ?? '?'}–${first.end_page ?? '?'}`); return; }
        setReadingStatus('Chapters TBD');
      } catch { setReadingStatus('Chapters TBD'); }
    };
    fetchReadingStatus();
  }, [clubType, season.id]);

  const uniquePicks = moviePicks.filter((p, i, arr) => arr.findIndex(x => x.watch_order === p.watch_order) === i)
    .sort((a, b) => (a.watch_order ?? 0) - (b.watch_order ?? 0));

  const overviewText = currentMovie?.overview || '';
  const overviewLong = overviewText.length > 160;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="glass-card rounded-2xl p-4 sm:p-6 mb-4 sm:mb-6"
    >
      {/* Status badge row — season title removed (shown in header) */}
      <div className="flex items-center justify-between gap-2 mb-4">
        <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${
          season.status === 'watching'
            ? 'bg-primary/10 border-primary/25 text-primary'
            : season.status === 'completed'
            ? 'bg-green-500/15 border-green-500/25 text-green-400'
            : 'bg-muted/30 border-border/50 text-muted-foreground'
        }`}>
          {season.status === 'watching'
            ? clubType === 'book'
              ? `Currently reading: ${readingStatus ?? 'Chapters TBD'}`
              : `${labels.Item} ${season.current_movie_index + 1} of ${uniquePicks.length}`
            : labels.statusLabels[season.status]}
        </span>
        {season.status === 'completed' && <ShareSeasonButton season={season} group={group} labels={labels} />}
      </div>

      {/* Movie club: cinematic full-bleed Now Watching hero */}
      {season.status === 'watching' && currentMovie && clubType !== 'book' && (() => {
        const pickerRevealed = !season.guessing_enabled || (currentMovie.revealed && (currentMovie.watch_order ?? 0) < season.current_movie_index);
        const pickerName = getProfile(currentMovie.user_id)?.display_name ?? '?';
        return (
          <div className="relative overflow-hidden rounded-2xl min-h-[300px] sm:min-h-[280px] flex flex-col justify-end ring-1 ring-white/5">
            {/* Backdrop layer */}
            {backdropUrl ? (
              <img src={backdropUrl} alt="" className="absolute inset-0 w-full h-full object-cover" style={{ filter: 'saturate(1.15)' }} />
            ) : posterUrl ? (
              <div className="absolute inset-0" style={{ backgroundImage: `url(${posterUrl})`, backgroundSize: 'cover', backgroundPosition: 'center top', filter: 'blur(30px) saturate(1.4)', transform: 'scale(1.2)', opacity: 0.5 }} />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-muted/20 to-card" />
            )}
            {/* Scrims for legibility */}
            <div className="absolute inset-0 bg-gradient-to-t from-card via-card/70 to-card/10" />
            <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_80%_10%,hsl(38_90%_55%/0.12),transparent_55%)]" />

            {/* Top row: live pill + step count */}
            <div className="absolute top-3 left-3 right-3 flex items-center justify-between z-10">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-black/50 backdrop-blur-sm border border-primary/30 px-2.5 py-1">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping-slow absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
                </span>
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">{labels.nowAction}</span>
              </span>
              <span className="rounded-full bg-black/50 backdrop-blur-sm border border-white/10 px-2.5 py-1 text-[11px] font-bold tabular-nums">
                {season.current_movie_index + 1} <span className="text-muted-foreground font-medium">of {uniquePicks.length}</span>
              </span>
            </div>

            {/* Overlaid content */}
            <div className="relative z-10 p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-1.5 text-xs font-medium">
                {rating != null && <span className="text-amber-400">★ {rating.toFixed(1)}</span>}
                {currentMovie.year && <><span className="text-muted-foreground/40">·</span><span className="text-muted-foreground">{currentMovie.year}</span></>}
                {director && <><span className="text-muted-foreground/40">·</span><span className="text-muted-foreground">dir. {director}</span></>}
              </div>

              <h3 className="font-display text-2xl sm:text-3xl font-bold leading-[1.05] drop-shadow-sm">{currentMovie.title}</h3>

              {/* Picker / guess line */}
              {pickerRevealed ? (
                <p className="text-xs text-primary mt-2 inline-flex items-center gap-1.5">
                  <Eye className="w-3 h-3" /> Picked by {pickerName}
                </p>
              ) : (
                <span className="inline-flex items-center gap-1.5 mt-2 rounded-full bg-violet-500/15 border border-violet-500/25 px-2.5 py-1 text-[11px] font-medium text-violet-300">
                  <User className="w-3 h-3" /> Picker hidden — see your guess below
                </span>
              )}

              {/* Overview with truncation */}
              {overviewText && (
                <div className="mt-2.5">
                  <p className={`text-xs sm:text-sm text-foreground/80 leading-relaxed ${!overviewExpanded && overviewLong ? 'line-clamp-2' : ''}`}>
                    {overviewText}
                  </p>
                  {overviewLong && (
                    <button onClick={() => setOverviewExpanded(e => !e)} className="mt-1 flex items-center gap-0.5 text-[11px] text-primary/80 hover:text-primary transition-colors">
                      {overviewExpanded ? <><ChevronUp className="w-3 h-3" /> Less</> : <><ChevronDown className="w-3 h-3" /> More</>}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Book club: compact cover + title */}
      {season.status === 'watching' && currentMovie && clubType === 'book' && (
        <div className="flex items-center gap-3 mt-4">
          {posterUrl ? (
            <img src={posterUrl} alt={currentMovie.title} className="w-12 sm:w-14 rounded-lg shadow-md ring-1 ring-border/20 shrink-0" />
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

      {/* Next call / meeting */}
      {season.next_call_date && callIsFuture && (() => {
        const d = new Date(season.next_call_date);
        return (
          <div className={`mt-4 rounded-2xl p-3 flex items-center gap-3 ${callSoon ? 'bg-amber-500/10 border border-amber-500/25' : 'bg-muted/15 border border-border/30'}`}>
            {/* Date chip */}
            <div className={`shrink-0 w-12 h-12 rounded-xl flex flex-col items-center justify-center ${callSoon ? 'bg-amber-500/15 border border-amber-500/30' : 'bg-muted/30 border border-border/40'}`}>
              <span className={`font-display text-[9px] font-bold uppercase tracking-wide ${callSoon ? 'text-amber-400' : 'text-muted-foreground'}`}>{format(d, 'EEE')}</span>
              <span className="font-display text-base font-bold leading-none">{format(d, 'h')}<span className="text-[9px] ml-0.5">{format(d, 'a')}</span></span>
            </div>
            {/* Text */}
            <div className="flex-1 min-w-0">
              <p className={`text-[10px] font-bold uppercase tracking-wider ${callSoon ? 'text-amber-400' : 'text-primary/70'}`}>
                Next {isInPerson ? 'meeting' : 'call'}{callIsToday ? ' · Today' : callIsTomorrow ? ' · Tomorrow' : ''}
              </p>
              <p className="text-sm font-semibold truncate">{format(d, 'EEE, MMM d · h:mm a')}</p>
              {!callSoon && <p className="text-[11px] text-muted-foreground">{formatDistanceToNow(d, { addSuffix: true })}</p>}
              {isInPerson && group?.meeting_location && (
                <p className="text-[11px] text-muted-foreground truncate inline-flex items-center gap-1 mt-0.5">
                  <MapPin className="w-3 h-3 text-primary shrink-0" /> {group.meeting_location}
                </p>
              )}
            </div>
            {/* CTA */}
            {!isInPerson && season.call_link && (
              <a
                href={season.call_link}
                target="_blank"
                rel="noopener noreferrer"
                className={`shrink-0 inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-full transition-all ${
                  callSoon
                    ? 'bg-amber-500 text-black hover:bg-amber-400 shadow-[0_4px_16px_-4px_rgba(245,158,11,0.5)]'
                    : 'bg-primary/15 text-primary hover:bg-primary/25 border border-primary/20'
                }`}
              >
                <Video className="w-3.5 h-3.5" /> Join <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        );
      })()}

      {/* Call link / meeting location — always show when set, unless already shown in the future-call block above */}
      {(!season.next_call_date || !callIsFuture) && season.call_link && !isInPerson && (
        <div className="mt-4">
          <a href={season.call_link} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors bg-primary/10 hover:bg-primary/15 px-3 py-1.5 rounded-full border border-primary/20">
            <Video className="w-4 h-4" /> Join Call <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}
      {(!season.next_call_date || !callIsFuture) && isInPerson && group?.meeting_location && (
        <div className="mt-4">
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground bg-muted/30 px-3 py-1.5 rounded-full">
            <MapPin className="w-4 h-4 text-primary" /> {group.meeting_location}
          </span>
        </div>
      )}

      {/* Progress bar */}
      {season.status === 'watching' && clubType !== 'book' && (() => {
        const doneCount = Math.min(season.current_movie_index, uniquePicks.length);
        const hasCurrent = season.current_movie_index < uniquePicks.length;
        const upCount = Math.max(0, uniquePicks.length - doneCount - (hasCurrent ? 1 : 0));
        return (
          <div className="mt-4 space-y-2">
            <div className="flex gap-1">
              {uniquePicks.map((pick) => {
                const state = (pick.watch_order ?? 0) < season.current_movie_index ? 'done'
                  : (pick.watch_order ?? 0) === season.current_movie_index ? 'current' : 'upcoming';
                return (
                  <div key={pick.id} title={pick.title} className={`relative h-2 flex-1 rounded-full transition-all duration-500 ${
                    state === 'done' ? 'bg-emerald-500'
                    : state === 'current' ? 'bg-gradient-to-r from-primary to-amber-300 shadow-[0_0_10px_-1px_hsl(38_90%_55%/0.6)]'
                    : 'bg-muted/40'
                  }`}>
                    {state === 'current' && (
                      <span className="absolute inset-0 rounded-full animate-pulse bg-primary/30" />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-3 text-[11px] font-medium text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /> {doneCount} watched</span>
              {hasCurrent && <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-primary" /> 1 now</span>}
              {upCount > 0 && <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-muted-foreground/40" /> {upCount} up next</span>}
            </div>
          </div>
        );
      })()}
    </motion.div>
  );
};

// Small share button for completed seasons
const ShareSeasonButton = ({ season, group, labels }: { season: Season; group?: Group; labels: ReturnType<typeof getClubLabels> }) => {
  const { share, sharing } = useShare();
  const onClick = () => {
    const groupName = group?.name || 'My Movie Club';
    const seasonLabel = `${labels.seasonNoun} ${season.season_number}${season.title ? ` — ${season.title}` : ''}`;
    share({
      title: `${groupName} · ${seasonLabel}`,
      text: `${groupName} just wrapped ${seasonLabel}!`,
      url: typeof window !== 'undefined' ? window.location.href : undefined,
    });
  };
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={sharing}
      className="h-7 px-2.5 text-xs font-medium text-muted-foreground hover:text-primary"
    >
      <Share2 className="w-3.5 h-3.5 mr-1" /> Share
    </Button>
  );
};

export default SeasonStatus;
