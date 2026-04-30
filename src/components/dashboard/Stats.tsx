import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Profile } from '@/hooks/useGroup';
import { Film, Clock, Star, Globe, Calendar, Tag, Trophy, BarChart3, Languages, BookOpen } from 'lucide-react';
import { TMDB_API_TOKEN } from '@/lib/apiKeys';
import { getClubLabels } from '@/lib/clubTypes';

interface Props {
  group: { id: string; club_type?: string };
  profiles: Profile[];
  members: { user_id: string }[];
}

interface PickRow {
  id: string;
  title: string;
  user_id: string;
  year: string | null;
  tmdb_id: number | null;
  watch_order: number | null;
  season_id: string;
  poster_url: string | null;
}

interface SeasonInfo {
  id: string;
  status: string;
  current_movie_index: number;
}

interface TmdbDetails {
  runtime: number | null;
  vote_average: number | null;
  release_date: string | null;
  genres: { id: number; name: string }[];
  original_language: string | null;
  production_countries: { iso_3166_1: string; name: string }[];
}

const TMDB_CACHE_KEY = 'mc_tmdb_details_v1';

const loadTmdbCache = (): Record<string, TmdbDetails> => {
  try {
    const raw = sessionStorage.getItem(TMDB_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const saveTmdbCache = (cache: Record<string, TmdbDetails>) => {
  try {
    sessionStorage.setItem(TMDB_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // ignore quota
  }
};

const formatRuntime = (mins: number) => {
  if (mins <= 0) return '0m';
  const days = Math.floor(mins / (60 * 24));
  const hours = Math.floor((mins % (60 * 24)) / 60);
  const m = mins % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (m && !days) parts.push(`${m}m`);
  return parts.join(' ') || `${mins}m`;
};

const decadeOf = (year: string | null | undefined) => {
  if (!year) return null;
  const y = parseInt(year.slice(0, 4), 10);
  if (!Number.isFinite(y)) return null;
  return Math.floor(y / 10) * 10;
};

const Stats = ({ group, profiles, members }: Props) => {
  const labels = getClubLabels((group.club_type || 'movie') as any);
  const isBookClub = labels.type === 'book';

  const [picks, setPicks] = useState<PickRow[]>([]);
  const [tmdbDetails, setTmdbDetails] = useState<Record<string, TmdbDetails>>({});
  const [loading, setLoading] = useState(true);
  const [enrichLoading, setEnrichLoading] = useState(false);

  // Fetch watched picks
  useEffect(() => {
    const run = async () => {
      setLoading(true);
      const { data: seasonsData } = await supabase
        .from('seasons')
        .select('id, status, current_movie_index')
        .eq('group_id', group.id);
      const seasons = (seasonsData || []) as SeasonInfo[];
      const seasonMap = new Map(seasons.map(s => [s.id, s]));
      const seasonIds = seasons.map(s => s.id);
      if (seasonIds.length === 0) {
        setPicks([]);
        setLoading(false);
        return;
      }
      const { data: picksData } = await supabase
        .from('movie_picks')
        .select('id, title, user_id, year, tmdb_id, watch_order, season_id, poster_url')
        .in('season_id', seasonIds);

      const watched = ((picksData || []) as PickRow[]).filter(p => {
        const s = seasonMap.get(p.season_id);
        if (!s) return false;
        if (s.status === 'completed' || s.status === 'reviewing') return true;
        if (s.status === 'watching' && p.watch_order != null) return p.watch_order < s.current_movie_index;
        return false;
      });
      setPicks(watched);
      setLoading(false);
    };
    run();
  }, [group.id]);

  // Enrich with TMDB details (movie clubs only)
  useEffect(() => {
    if (isBookClub) return;
    if (picks.length === 0) return;
    let cancelled = false;

    const enrich = async () => {
      const cache = loadTmdbCache();
      const initial: Record<string, TmdbDetails> = {};
      const toFetch: PickRow[] = [];
      for (const p of picks) {
        const cacheKey = p.tmdb_id ? `id:${p.tmdb_id}` : `t:${p.title}|${p.year || ''}`;
        if (cache[cacheKey]) {
          initial[p.id] = cache[cacheKey];
        } else {
          toFetch.push(p);
        }
      }
      if (Object.keys(initial).length) setTmdbDetails(prev => ({ ...prev, ...initial }));
      if (toFetch.length === 0 || !TMDB_API_TOKEN) return;

      setEnrichLoading(true);
      const headers = { Authorization: `Bearer ${TMDB_API_TOKEN}`, Accept: 'application/json' };

      // simple concurrency 4
      const queue = [...toFetch];
      const workers = Array.from({ length: 4 }, async () => {
        while (queue.length && !cancelled) {
          const p = queue.shift()!;
          const cacheKey = p.tmdb_id ? `id:${p.tmdb_id}` : `t:${p.title}|${p.year || ''}`;
          try {
            let tmdbId = p.tmdb_id;
            if (!tmdbId) {
              const yp = p.year ? `&year=${p.year}` : '';
              const r = await fetch(
                `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(p.title)}&include_adult=false&language=en-US&page=1${yp}`,
                { headers }
              );
              const d = await r.json();
              tmdbId = d.results?.[0]?.id || null;
            }
            if (!tmdbId) continue;
            const r2 = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?language=en-US`, { headers });
            if (!r2.ok) continue;
            const d2 = await r2.json();
            const details: TmdbDetails = {
              runtime: d2.runtime ?? null,
              vote_average: d2.vote_average ?? null,
              release_date: d2.release_date ?? null,
              genres: Array.isArray(d2.genres) ? d2.genres : [],
              original_language: d2.original_language ?? null,
              production_countries: Array.isArray(d2.production_countries) ? d2.production_countries : [],
            };
            cache[cacheKey] = details;
            if (!cancelled) {
              setTmdbDetails(prev => ({ ...prev, [p.id]: details }));
            }
          } catch {
            // skip
          }
        }
      });

      await Promise.all(workers);
      saveTmdbCache(cache);
      if (!cancelled) setEnrichLoading(false);
    };

    enrich();
    return () => { cancelled = true; };
  }, [picks, isBookClub]);

  const stats = useMemo(() => {
    const total = picks.length;

    // Decade breakdown — prefer TMDB release_date, fallback to year
    const decadeCounts = new Map<number, number>();
    for (const p of picks) {
      const det = tmdbDetails[p.id];
      const yr = det?.release_date?.slice(0, 4) || p.year || null;
      const dec = decadeOf(yr);
      if (dec != null) decadeCounts.set(dec, (decadeCounts.get(dec) || 0) + 1);
    }
    const decadeRows = Array.from(decadeCounts.entries()).sort((a, b) => a[0] - b[0]);

    // Genre breakdown
    const genreCounts = new Map<string, number>();
    for (const p of picks) {
      const det = tmdbDetails[p.id];
      if (!det) continue;
      for (const g of det.genres) {
        genreCounts.set(g.name, (genreCounts.get(g.name) || 0) + 1);
      }
    }
    const genreRows = Array.from(genreCounts.entries()).sort((a, b) => b[1] - a[1]);

    // Language
    const langCounts = new Map<string, number>();
    for (const p of picks) {
      const det = tmdbDetails[p.id];
      if (!det?.original_language) continue;
      langCounts.set(det.original_language, (langCounts.get(det.original_language) || 0) + 1);
    }
    const langRows = Array.from(langCounts.entries()).sort((a, b) => b[1] - a[1]);

    // Country
    const countryCounts = new Map<string, number>();
    for (const p of picks) {
      const det = tmdbDetails[p.id];
      if (!det) continue;
      for (const c of det.production_countries) {
        countryCounts.set(c.name, (countryCounts.get(c.name) || 0) + 1);
      }
    }
    const countryRows = Array.from(countryCounts.entries()).sort((a, b) => b[1] - a[1]);

    // Runtime
    let totalRuntime = 0;
    let runtimeCount = 0;
    let longest: { title: string; runtime: number; pickId: string } | null = null;
    let shortest: { title: string; runtime: number; pickId: string } | null = null;
    for (const p of picks) {
      const det = tmdbDetails[p.id];
      if (det?.runtime && det.runtime > 0) {
        totalRuntime += det.runtime;
        runtimeCount += 1;
        if (!longest || det.runtime > longest.runtime) longest = { title: p.title, runtime: det.runtime, pickId: p.id };
        if (!shortest || det.runtime < shortest.runtime) shortest = { title: p.title, runtime: det.runtime, pickId: p.id };
      }
    }

    // Ratings
    let highestRated: { title: string; rating: number; pickId: string } | null = null;
    let lowestRated: { title: string; rating: number; pickId: string } | null = null;
    let ratingSum = 0;
    let ratingCount = 0;
    for (const p of picks) {
      const det = tmdbDetails[p.id];
      if (det?.vote_average && det.vote_average > 0) {
        ratingSum += det.vote_average;
        ratingCount += 1;
        if (!highestRated || det.vote_average > highestRated.rating) highestRated = { title: p.title, rating: det.vote_average, pickId: p.id };
        if (!lowestRated || det.vote_average < lowestRated.rating) lowestRated = { title: p.title, rating: det.vote_average, pickId: p.id };
      }
    }

    // Picker counts
    const pickerCounts = new Map<string, number>();
    for (const p of picks) {
      pickerCounts.set(p.user_id, (pickerCounts.get(p.user_id) || 0) + 1);
    }
    const pickerRows = Array.from(pickerCounts.entries())
      .map(([uid, count]) => ({
        uid,
        name: profiles.find(pr => pr.user_id === uid)?.display_name || 'Unknown',
        count,
      }))
      .sort((a, b) => b.count - a.count);

    // Oldest / newest
    const datedPicks = picks
      .map(p => {
        const det = tmdbDetails[p.id];
        const yr = det?.release_date?.slice(0, 4) || p.year || null;
        const y = yr ? parseInt(yr, 10) : NaN;
        return Number.isFinite(y) ? { p, y } : null;
      })
      .filter(Boolean) as { p: PickRow; y: number }[];
    const oldest = datedPicks.length ? datedPicks.reduce((a, b) => (a.y < b.y ? a : b)) : null;
    const newest = datedPicks.length ? datedPicks.reduce((a, b) => (a.y > b.y ? a : b)) : null;

    return {
      total,
      decadeRows,
      genreRows,
      langRows,
      countryRows,
      totalRuntime,
      runtimeCount,
      longest,
      shortest,
      highestRated,
      lowestRated,
      avgRating: ratingCount > 0 ? ratingSum / ratingCount : null,
      pickerRows,
      oldest,
      newest,
    };
  }, [picks, tmdbDetails, profiles]);

  if (loading) {
    return <div className="text-center text-muted-foreground py-12">Loading stats...</div>;
  }

  if (picks.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-12">
        <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p>No {labels.items} {labels.watched} yet</p>
      </div>
    );
  }

  const maxDecade = Math.max(1, ...stats.decadeRows.map(([, c]) => c));
  const maxGenre = Math.max(1, ...stats.genreRows.map(([, c]) => c));
  const maxPicker = Math.max(1, ...stats.pickerRows.map(r => r.count));

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Headline cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<Film className="w-4 h-4" />}
          label={`${labels.itemsTitle || labels.items} ${labels.watched}`}
          value={stats.total.toString()}
        />
        {!isBookClub && (
          <StatCard
            icon={<Clock className="w-4 h-4" />}
            label="Total runtime"
            value={stats.runtimeCount > 0 ? formatRuntime(stats.totalRuntime) : '—'}
            sub={stats.runtimeCount > 0 && stats.runtimeCount < stats.total ? `from ${stats.runtimeCount}/${stats.total}` : undefined}
          />
        )}
        {!isBookClub && (
          <StatCard
            icon={<Star className="w-4 h-4" />}
            label="Avg TMDB rating"
            value={stats.avgRating != null ? stats.avgRating.toFixed(1) : '—'}
          />
        )}
        <StatCard
          icon={<Calendar className="w-4 h-4" />}
          label="Year range"
          value={
            stats.oldest && stats.newest
              ? `${stats.oldest.y}–${stats.newest.y}`
              : '—'
          }
        />
      </div>

      {/* Decades */}
      <Section title="By decade" icon={<Calendar className="w-4 h-4" />}>
        {stats.decadeRows.length === 0 ? (
          <Empty />
        ) : (
          <div className="space-y-1.5">
            {stats.decadeRows.map(([dec, count]) => (
              <BarRow key={dec} label={`${dec}s`} count={count} max={maxDecade} />
            ))}
          </div>
        )}
      </Section>

      {/* Pickers */}
      <Section title="Picks per member" icon={<Trophy className="w-4 h-4" />}>
        <div className="space-y-1.5">
          {stats.pickerRows.map(r => (
            <BarRow key={r.uid} label={r.name} count={r.count} max={maxPicker} />
          ))}
        </div>
      </Section>

      {/* Movie-only sections */}
      {!isBookClub && (
        <>
          <Section title="By genre" icon={<Tag className="w-4 h-4" />} sub={enrichLoading ? 'Loading TMDB data…' : undefined}>
            {stats.genreRows.length === 0 ? (
              <Empty hint="Pulled from TMDB" />
            ) : (
              <div className="space-y-1.5">
                {stats.genreRows.slice(0, 12).map(([name, count]) => (
                  <BarRow key={name} label={name} count={count} max={maxGenre} />
                ))}
              </div>
            )}
          </Section>

          <div className="grid md:grid-cols-2 gap-4">
            <Section title="Languages" icon={<Languages className="w-4 h-4" />}>
              {stats.langRows.length === 0 ? <Empty /> : (
                <ul className="text-sm space-y-1">
                  {stats.langRows.slice(0, 8).map(([lang, count]) => (
                    <li key={lang} className="flex justify-between">
                      <span className="uppercase text-muted-foreground">{lang}</span>
                      <span className="font-medium">{count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Countries" icon={<Globe className="w-4 h-4" />}>
              {stats.countryRows.length === 0 ? <Empty /> : (
                <ul className="text-sm space-y-1">
                  {stats.countryRows.slice(0, 8).map(([name, count]) => (
                    <li key={name} className="flex justify-between">
                      <span className="text-muted-foreground">{name}</span>
                      <span className="font-medium">{count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Section title="Records" icon={<Trophy className="w-4 h-4" />}>
              <ul className="text-sm space-y-2">
                <RecordRow label="Longest" value={stats.longest ? `${stats.longest.title} · ${formatRuntime(stats.longest.runtime)}` : '—'} />
                <RecordRow label="Shortest" value={stats.shortest ? `${stats.shortest.title} · ${formatRuntime(stats.shortest.runtime)}` : '—'} />
                <RecordRow label="Highest rated" value={stats.highestRated ? `${stats.highestRated.title} · ${stats.highestRated.rating.toFixed(1)}` : '—'} />
                <RecordRow label="Lowest rated" value={stats.lowestRated ? `${stats.lowestRated.title} · ${stats.lowestRated.rating.toFixed(1)}` : '—'} />
                <RecordRow label="Oldest" value={stats.oldest ? `${stats.oldest.p.title} · ${stats.oldest.y}` : '—'} />
                <RecordRow label="Newest" value={stats.newest ? `${stats.newest.p.title} · ${stats.newest.y}` : '—'} />
              </ul>
            </Section>
            <Section title="Coverage" icon={<BookOpen className="w-4 h-4" />}>
              <p className="text-sm text-muted-foreground">
                TMDB details loaded for{' '}
                <span className="text-foreground font-medium">
                  {Object.keys(tmdbDetails).length}/{stats.total}
                </span>{' '}
                {labels.items}.
                {enrichLoading && ' Still fetching…'}
              </p>
            </Section>
          </div>
        </>
      )}
    </div>
  );
};

const StatCard = ({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) => (
  <div className="glass-card rounded-xl p-3 sm:p-4">
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
      {icon}
      <span className="truncate">{label}</span>
    </div>
    <div className="text-lg sm:text-2xl font-display font-bold text-gradient-gold leading-tight">{value}</div>
    {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
  </div>
);

const Section = ({ title, icon, children, sub }: { title: string; icon: React.ReactNode; children: React.ReactNode; sub?: string }) => (
  <div className="glass-card rounded-2xl p-4 sm:p-5">
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </div>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
    {children}
  </div>
);

const BarRow = ({ label, count, max }: { label: string; count: number; max: number }) => (
  <div className="flex items-center gap-3">
    <div className="w-24 sm:w-32 text-xs sm:text-sm truncate">{label}</div>
    <div className="flex-1 h-2 bg-muted/40 rounded-full overflow-hidden">
      <div
        className="h-full bg-gradient-to-r from-primary/70 to-primary rounded-full"
        style={{ width: `${(count / max) * 100}%` }}
      />
    </div>
    <div className="w-8 text-right text-xs sm:text-sm font-medium tabular-nums">{count}</div>
  </div>
);

const RecordRow = ({ label, value }: { label: string; value: string }) => (
  <li className="flex justify-between gap-3">
    <span className="text-muted-foreground shrink-0">{label}</span>
    <span className="font-medium text-right truncate">{value}</span>
  </li>
);

const Empty = ({ hint }: { hint?: string } = {}) => (
  <p className="text-sm text-muted-foreground">No data yet{hint ? ` — ${hint}` : ''}.</p>
);

export default Stats;
