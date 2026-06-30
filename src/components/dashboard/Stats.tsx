import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Profile } from '@/hooks/useGroup';
import { Film, Clock, Star, Globe, Calendar, Tag, Trophy, BarChart3, Languages, BookOpen, ChevronLeft, ChevronRight, Check, X, Trophy as TrophyIcon, Users, Clapperboard, Building2, Share2, Crown } from 'lucide-react';
import { TMDB_API_TOKEN } from '@/lib/apiKeys';
import { getClubLabels } from '@/lib/clubTypes';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';
import { useShare } from '@/hooks/useShare';

interface Props {
  group: { id: string; name?: string; club_type?: string };
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
  season_number: number;
  title: string | null;
}

interface GuessRow {
  guesser_id: string;
  guessed_user_id: string;
  movie_pick_id: string;
  season_id: string;
}

interface RankingRow {
  user_id: string;
  movie_pick_id: string;
  rank: number;
  season_id: string;
}

interface CastMember {
  id: number;
  name: string;
  profile_path: string | null;
  character?: string | null;
  popularity?: number | null;
}

interface CrewMember {
  id: number;
  name: string;
  profile_path: string | null;
  popularity?: number | null;
}

interface ProductionCompany {
  id: number;
  name: string;
  logo_path: string | null;
}

interface TmdbDetails {
  runtime: number | null;
  vote_average: number | null;
  release_date: string | null;
  popularity: number | null;
  genres: { id: number; name: string }[];
  original_language: string | null;
  production_countries: { iso_3166_1: string; name: string }[];
  cast?: CastMember[];
  directors?: CrewMember[];
  production_companies?: ProductionCompany[];
}

const TMDB_CACHE_KEY = 'mc_tmdb_details_v6';

/** Normalize cached TMDB payloads so partial / legacy sessionStorage entries cannot crash Stats. */
const normalizeTmdbDetails = (raw: unknown): TmdbDetails | null => {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const genres = Array.isArray(d.genres) ? (d.genres as { id: number; name: string }[]) : [];
  const production_countries = Array.isArray(d.production_countries)
    ? (d.production_countries as { iso_3166_1: string; name: string }[])
    : [];
  const cast = Array.isArray(d.cast) ? (d.cast as CastMember[]) : undefined;
  const directors = Array.isArray(d.directors) ? (d.directors as CrewMember[]) : undefined;
  const production_companies = Array.isArray(d.production_companies)
    ? (d.production_companies as ProductionCompany[])
    : undefined;
  return {
    runtime: typeof d.runtime === 'number' ? d.runtime : null,
    vote_average: typeof d.vote_average === 'number' ? d.vote_average : null,
    release_date: typeof d.release_date === 'string' ? d.release_date : null,
    popularity: typeof d.popularity === 'number' ? d.popularity : null,
    genres,
    original_language: typeof d.original_language === 'string' ? d.original_language : null,
    production_countries,
    cast,
    directors,
    production_companies,
  };
};

const loadTmdbCache = (): Record<string, TmdbDetails> => {
  try {
    const raw = sessionStorage.getItem(TMDB_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, TmdbDetails> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const n = normalizeTmdbDetails(v);
      if (n) out[k] = n;
    }
    return out;
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

interface DrillDown {
  title: string;
  pickIds: string[];
  mode?: 'default' | 'decade';
}

// Convert 0..1 love score → 0..5 stars (continuous decimal)
const toStars = (avg: number) => Math.max(0, Math.min(5, avg * 5));

const StarRating = ({ avg, size = 14 }: { avg: number; size?: number }) => {
  const stars = toStars(avg);
  return (
    <div className="flex items-center gap-0.5" aria-label={`${stars.toFixed(1)} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map(i => {
        const fill = Math.max(0, Math.min(1, stars - (i - 1)));
        return (
          <div key={i} className="relative" style={{ width: size, height: size }}>
            <Star className="absolute inset-0 text-muted-foreground/30" style={{ width: size, height: size }} />
            {fill > 0 && (
              <div className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                <Star className="text-primary fill-primary" style={{ width: size, height: size }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── Skeleton ──────────────────────────────────────────────────────────────────
const StatsSkeleton = () => (
  <div className="space-y-4 sm:space-y-6 animate-pulse">
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="glass-card rounded-xl p-3 sm:p-4 h-[72px]">
          <div className="h-3 w-16 bg-muted/60 rounded mb-3" />
          <div className="h-6 w-12 bg-muted/50 rounded" />
        </div>
      ))}
    </div>
    {[...Array(3)].map((_, i) => (
      <div key={i} className="glass-card rounded-2xl p-4 sm:p-5">
        <div className="h-4 w-28 bg-muted/60 rounded mb-4" />
        <div className="space-y-2.5">
          {[...Array(4)].map((_, j) => (
            <div key={j} className="flex items-center gap-3">
              <div className="w-20 h-2.5 bg-muted/50 rounded" />
              <div
                className="h-2 bg-muted/40 rounded-full"
                style={{ flex: 1, maxWidth: `${55 + ((i * 4 + j) * 13) % 40}%` }}
              />
              <div className="w-5 h-2.5 bg-muted/50 rounded" />
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>
);

const Stats = ({ group, profiles, members }: Props) => {
  const labels = getClubLabels((group.club_type || 'movie') as any);
  const isBookClub = labels.type === 'book';

  const [picks, setPicks] = useState<PickRow[]>([]);
  const [seasons, setSeasons] = useState<SeasonInfo[]>([]);
  const [guesses, setGuesses] = useState<GuessRow[]>([]);
  const [rankings, setRankings] = useState<RankingRow[]>([]);
  const [tmdbDetails, setTmdbDetails] = useState<Record<string, TmdbDetails>>({});
  const [loading, setLoading] = useState(true);
  const [enrichLoading, setEnrichLoading] = useState(false);

  // Drill-down state — list of pickIds + selected pickId for full detail
  const [drill, setDrill] = useState<DrillDown | null>(null);
  const [selectedPickId, setSelectedPickId] = useState<string | null>(null);

  const { share, sharing } = useShare();

  const getProfile = (uid: string) => profiles.find(p => p.user_id === uid);
  const getName = (uid: string) => getProfile(uid)?.display_name || 'Unknown';

  // Fetch watched picks + seasons + guesses + rankings
  useEffect(() => {
    const run = async () => {
      setLoading(true);
      const { data: seasonsData } = await supabase
        .from('seasons')
        .select('id, status, current_movie_index, season_number, title')
        .eq('group_id', group.id);
      const seasonRows = (seasonsData || []) as SeasonInfo[];
      setSeasons(seasonRows);
      const seasonMap = new Map(seasonRows.map(s => [s.id, s]));
      const seasonIds = seasonRows.map(s => s.id);
      if (seasonIds.length === 0) {
        setPicks([]);
        setGuesses([]);
        setRankings([]);
        setLoading(false);
        return;
      }

      const [picksRes, guessesRes, rankingsRes] = await Promise.all([
        supabase.from('movie_picks')
          .select('id, title, user_id, year, tmdb_id, watch_order, season_id, poster_url')
          .in('season_id', seasonIds),
        supabase.from('guesses')
          .select('guesser_id, guessed_user_id, movie_pick_id, season_id')
          .in('season_id', seasonIds),
        supabase.from('movie_rankings')
          .select('user_id, movie_pick_id, rank, season_id')
          .in('season_id', seasonIds),
      ]);

      const watched = ((picksRes.data || []) as PickRow[]).filter(p => {
        const s = seasonMap.get(p.season_id);
        if (!s) return false;
        if (s.status === 'completed' || s.status === 'reviewing') return true;
        if (s.status === 'watching' && p.watch_order != null) return p.watch_order < s.current_movie_index;
        return false;
      });

      setPicks(watched);
      setGuesses((guessesRes.data || []) as GuessRow[]);
      setRankings((rankingsRes.data || []) as RankingRow[]);
      setLoading(false);
    };
    run();
  }, [group.id]);

  // Enrich with TMDB
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
        // Only use cache if it has full stats data (cast present = fetched by Stats, not MemberList)
        if (cache[cacheKey] && cache[cacheKey].cast !== undefined) {
          initial[p.id] = cache[cacheKey];
        } else {
          toFetch.push(p);
        }
      }
      if (Object.keys(initial).length) setTmdbDetails(prev => ({ ...prev, ...initial }));
      if (toFetch.length === 0 || !TMDB_API_TOKEN) return;

      setEnrichLoading(true);
      const headers = { Authorization: `Bearer ${TMDB_API_TOKEN}`, Accept: 'application/json' };
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
            const r2 = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?language=en-US&append_to_response=credits`, { headers });
            if (!r2.ok) continue;
            const d2 = await r2.json();
            const rawCast = Array.isArray(d2.credits?.cast) ? d2.credits.cast : [];
            const cast: CastMember[] = rawCast
              .slice(0, 10)
              .map((c: any) => ({
                id: c.id,
                name: c.name,
                profile_path: c.profile_path ?? null,
                character: c.character ?? null,
                popularity: typeof c.popularity === 'number' ? c.popularity : null,
              }));
            const rawCrew = Array.isArray(d2.credits?.crew) ? d2.credits.crew : [];
            const directors: CrewMember[] = rawCrew
              .filter((c: any) => c.job === 'Director')
              .map((c: any) => ({
                id: c.id,
                name: c.name,
                profile_path: c.profile_path ?? null,
                popularity: typeof c.popularity === 'number' ? c.popularity : null,
              }));
            const rawCompanies = Array.isArray(d2.production_companies) ? d2.production_companies : [];
            const production_companies: ProductionCompany[] = rawCompanies.map((c: any) => ({
              id: c.id,
              name: c.name,
              logo_path: c.logo_path ?? null,
            }));
            const details: TmdbDetails = {
              runtime: d2.runtime ?? null,
              vote_average: d2.vote_average ?? null,
              release_date: d2.release_date ?? null,
              popularity: typeof d2.popularity === 'number' ? d2.popularity : null,
              genres: Array.isArray(d2.genres) ? d2.genres : [],
              original_language: d2.original_language ?? null,
              production_countries: Array.isArray(d2.production_countries) ? d2.production_countries : [],
              cast,
              directors,
              production_companies,
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

  // Group co-picks: same season + watch_order = one "movie entry", multiple pickers
  const movieEntries = useMemo(() => {
    const grouped = new Map<string, PickRow[]>();
    for (const p of picks) {
      const key = p.watch_order != null ? `${p.season_id}:${p.watch_order}` : `solo:${p.id}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(p);
    }
    return Array.from(grouped.values()).map(group => ({
      canonical: group[0],
      pickerIds: group.map(p => p.user_id),
      siblingPickIds: group.map(p => p.id),
    }));
  }, [picks]);

  // Map each pickId -> its movie entry's all sibling pickIds and pickerIds
  const pickIdToEntry = useMemo(() => {
    const m = new Map<string, { siblingPickIds: string[]; pickerIds: string[]; canonical: PickRow }>();
    for (const e of movieEntries) {
      for (const id of e.siblingPickIds) {
        m.set(id, e);
      }
    }
    return m;
  }, [movieEntries]);

  const stats = useMemo(() => {
    const canonicalPicks = movieEntries.map(e => e.canonical);
    const total = canonicalPicks.length;

    // Decade
    const decadeMap = new Map<number, string[]>();
    for (const p of canonicalPicks) {
      const det = tmdbDetails[p.id];
      const yr = det?.release_date?.slice(0, 4) || p.year || null;
      const dec = decadeOf(yr);
      if (dec != null) {
        if (!decadeMap.has(dec)) decadeMap.set(dec, []);
        decadeMap.get(dec)!.push(p.id);
      }
    }
    const decadeRows = Array.from(decadeMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([dec, ids]) => ({ key: `${dec}s`, label: `${dec}s`, count: ids.length, pickIds: ids }));

    // Genre
    const genreMap = new Map<string, string[]>();
    for (const p of canonicalPicks) {
      const det = tmdbDetails[p.id];
      if (!det) continue;
      for (const g of det.genres ?? []) {
        if (!genreMap.has(g.name)) genreMap.set(g.name, []);
        genreMap.get(g.name)!.push(p.id);
      }
    }
    const genreRows = Array.from(genreMap.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .map(([name, ids]) => ({ key: name, label: name, count: ids.length, pickIds: ids }));

    // Language
    const langMap = new Map<string, string[]>();
    for (const p of canonicalPicks) {
      const det = tmdbDetails[p.id];
      if (!det?.original_language) continue;
      if (!langMap.has(det.original_language)) langMap.set(det.original_language, []);
      langMap.get(det.original_language)!.push(p.id);
    }
    const langRows = Array.from(langMap.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .map(([code, ids]) => ({ key: code, label: code.toUpperCase(), count: ids.length, pickIds: ids }));

    // Country
    const countryMap = new Map<string, string[]>();
    for (const p of canonicalPicks) {
      const det = tmdbDetails[p.id];
      if (!det) continue;
      for (const c of det.production_countries ?? []) {
        if (!countryMap.has(c.name)) countryMap.set(c.name, []);
        countryMap.get(c.name)!.push(p.id);
      }
    }
    const countryRows = Array.from(countryMap.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .map(([name, ids]) => ({ key: name, label: name, count: ids.length, pickIds: ids }));

    // Actors
    const actorMap = new Map<number, { name: string; profile_path: string | null; pickIds: string[]; popularity: number }>();
    for (const p of canonicalPicks) {
      const det = tmdbDetails[p.id];
      if (!det) continue;
      const seen = new Set<number>();
      for (const c of det.cast ?? []) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        const pop = typeof c.popularity === 'number' ? c.popularity : 0;
        const existing = actorMap.get(c.id);
        if (existing) {
          existing.pickIds.push(p.id);
          if (pop > existing.popularity) existing.popularity = pop;
        } else {
          actorMap.set(c.id, { name: c.name, profile_path: c.profile_path, pickIds: [p.id], popularity: pop });
        }
      }
    }
    const actorRows = Array.from(actorMap.entries())
      .map(([id, v]) => ({ key: String(id), id, label: v.name, profile_path: v.profile_path, count: v.pickIds.length, pickIds: v.pickIds, popularity: v.popularity }))
      .filter(r => r.count >= 1)
      .sort((a, b) => b.count - a.count || (b.popularity - a.popularity) || a.label.localeCompare(b.label));

    // Directors
    const directorMap = new Map<number, { name: string; profile_path: string | null; pickIds: string[]; popularity: number }>();
    for (const p of canonicalPicks) {
      const det = tmdbDetails[p.id];
      if (!det) continue;
      const seen = new Set<number>();
      for (const c of det.directors ?? []) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        const pop = typeof c.popularity === 'number' ? c.popularity : 0;
        const existing = directorMap.get(c.id);
        if (existing) {
          existing.pickIds.push(p.id);
          if (pop > existing.popularity) existing.popularity = pop;
        } else {
          directorMap.set(c.id, { name: c.name, profile_path: c.profile_path, pickIds: [p.id], popularity: pop });
        }
      }
    }
    const directorRows = Array.from(directorMap.entries())
      .map(([id, v]) => ({ key: String(id), id, label: v.name, profile_path: v.profile_path, count: v.pickIds.length, pickIds: v.pickIds, popularity: v.popularity }))
      .sort((a, b) => b.count - a.count || (b.popularity - a.popularity) || a.label.localeCompare(b.label));

    // Production companies
    const companyMap = new Map<number, { name: string; logo_path: string | null; pickIds: string[] }>();
    for (const p of canonicalPicks) {
      const det = tmdbDetails[p.id];
      if (!det) continue;
      const seen = new Set<number>();
      for (const c of det.production_companies ?? []) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        const existing = companyMap.get(c.id);
        if (existing) existing.pickIds.push(p.id);
        else companyMap.set(c.id, { name: c.name, logo_path: c.logo_path, pickIds: [p.id] });
      }
    }
    const companyRows = Array.from(companyMap.entries())
      .map(([id, v]) => ({ key: String(id), id, label: v.name, logo_path: v.logo_path, count: v.pickIds.length, pickIds: v.pickIds }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    // Picker
    const pickerMap = new Map<string, string[]>();
    for (const e of movieEntries) {
      for (const uid of e.pickerIds) {
        if (!pickerMap.has(uid)) pickerMap.set(uid, []);
        pickerMap.get(uid)!.push(e.canonical.id);
      }
    }
    const pickerRows = Array.from(pickerMap.entries())
      .map(([uid, ids]) => ({ key: uid, label: getName(uid), count: ids.length, pickIds: ids }))
      .sort((a, b) => b.count - a.count);

    // Runtime
    let totalRuntime = 0;
    let runtimeCount = 0;
    let longest: { pickId: string; runtime: number } | null = null;
    let shortest: { pickId: string; runtime: number } | null = null;
    for (const p of canonicalPicks) {
      const det = tmdbDetails[p.id];
      if (det?.runtime && det.runtime > 0) {
        totalRuntime += det.runtime;
        runtimeCount += 1;
        if (!longest || det.runtime > longest.runtime) longest = { pickId: p.id, runtime: det.runtime };
        if (!shortest || det.runtime < shortest.runtime) shortest = { pickId: p.id, runtime: det.runtime };
      }
    }

    // Ratings
    let highestRated: { pickId: string; rating: number } | null = null;
    let lowestRated: { pickId: string; rating: number } | null = null;
    let ratingSum = 0;
    let ratingCount = 0;
    for (const p of canonicalPicks) {
      const det = tmdbDetails[p.id];
      if (det?.vote_average && det.vote_average > 0) {
        ratingSum += det.vote_average;
        ratingCount += 1;
        if (!highestRated || det.vote_average > highestRated.rating) highestRated = { pickId: p.id, rating: det.vote_average };
        if (!lowestRated || det.vote_average < lowestRated.rating) lowestRated = { pickId: p.id, rating: det.vote_average };
      }
    }

    // Oldest / newest
    const datedPicks = canonicalPicks
      .map(p => {
        const det = tmdbDetails[p.id];
        const yr = det?.release_date?.slice(0, 4) || p.year || null;
        const y = yr ? parseInt(yr, 10) : NaN;
        return Number.isFinite(y) ? { p, y } : null;
      })
      .filter(Boolean) as { p: PickRow; y: number }[];
    const oldest = datedPicks.length ? datedPicks.reduce((a, b) => (a.y < b.y ? a : b)) : null;
    const newest = datedPicks.length ? datedPicks.reduce((a, b) => (a.y > b.y ? a : b)) : null;
    const avgYear = datedPicks.length
      ? Math.round(datedPicks.reduce((s, d) => s + d.y, 0) / datedPicks.length)
      : null;
    let medianYear: number | null = null;
    if (datedPicks.length) {
      const sorted = [...datedPicks].map(d => d.y).sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      medianYear = sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
    }

    // Taste by decade
    const rankingsBySeason = new Map<string, RankingRow[]>();
    for (const r of rankings) {
      if (!rankingsBySeason.has(r.season_id)) rankingsBySeason.set(r.season_id, []);
      rankingsBySeason.get(r.season_id)!.push(r);
    }
    const seasonUserMax = new Map<string, number>();
    for (const [seasonId, rs] of rankingsBySeason) {
      const byUser = new Map<string, number[]>();
      for (const r of rs) {
        if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
        byUser.get(r.user_id)!.push(r.rank);
      }
      for (const [uid, ranks] of byUser) {
        if (ranks.length === 0) continue;
        seasonUserMax.set(`${seasonId}:${uid}`, Math.max(...ranks));
      }
    }

    const pickDecade = new Map<string, number>();
    for (const p of canonicalPicks) {
      const det = tmdbDetails[p.id];
      const yr = det?.release_date?.slice(0, 4) || p.year || null;
      const dec = decadeOf(yr);
      if (dec != null) pickDecade.set(p.id, dec);
    }
    const siblingDecade = new Map<string, number>();
    for (const e of movieEntries) {
      const dec = pickDecade.get(e.canonical.id);
      if (dec == null) continue;
      for (const sid of e.siblingPickIds) siblingDecade.set(sid, dec);
    }

    type DecadeAgg = { sum: number; count: number };
    const decadeOverall = new Map<number, DecadeAgg>();
    const memberDecade = new Map<string, Map<number, DecadeAgg>>();
    const pickLove = new Map<string, DecadeAgg>();
    const siblingToCanonical = new Map<string, string>();
    for (const e of movieEntries) {
      for (const sid of e.siblingPickIds) siblingToCanonical.set(sid, e.canonical.id);
    }

    for (const r of rankings) {
      const dec = siblingDecade.get(r.movie_pick_id);
      if (dec == null) continue;
      const N = seasonUserMax.get(`${r.season_id}:${r.user_id}`);
      if (!N || N < 2) continue;
      const love = (N - r.rank + 1) / N;
      const o = decadeOverall.get(dec) || { sum: 0, count: 0 };
      o.sum += love; o.count += 1;
      decadeOverall.set(dec, o);

      let m = memberDecade.get(r.user_id);
      if (!m) { m = new Map(); memberDecade.set(r.user_id, m); }
      const ma = m.get(dec) || { sum: 0, count: 0 };
      ma.sum += love; ma.count += 1;
      m.set(dec, ma);

      const canonId = siblingToCanonical.get(r.movie_pick_id);
      if (canonId) {
        const pl = pickLove.get(canonId) || { sum: 0, count: 0 };
        pl.sum += love; pl.count += 1;
        pickLove.set(canonId, pl);
      }
    }

    const tasteDecadeRows = Array.from(decadeOverall.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([dec, agg]) => ({
        decade: dec,
        label: `${dec}s`,
        avg: agg.sum / agg.count,
        count: agg.count,
        pickIds: decadeMap.get(dec) || [],
      }));

    const tasteMembers = Array.from(memberDecade.entries()).map(([uid, m]) => {
      const rows = Array.from(m.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([dec, agg]) => ({
          decade: dec,
          label: `${dec}s`,
          avg: agg.sum / agg.count,
          count: agg.count,
          pickIds: decadeMap.get(dec) || [],
        }));
      const sortedByAvg = [...rows].sort((a, b) => b.avg - a.avg);
      return {
        user_id: uid,
        name: getName(uid),
        rows,
        favorite: sortedByAvg[0],
        least: sortedByAvg[sortedByAvg.length - 1],
      };
    }).sort((a, b) => a.name.localeCompare(b.name));

    // Top Pickers leaderboard — ranked by how loved their picks are (avg group love → stars)
    const pickerLeaderboard = pickerRows.map(pr => {
      let sum = 0, count = 0;
      for (const pid of pr.pickIds) {
        const love = pickLove.get(pid);
        if (love && love.count > 0) { sum += love.sum / love.count; count += 1; }
      }
      const avgLove = count > 0 ? sum / count : null;
      return {
        user_id: pr.key,
        name: pr.label,
        avgLove,
        stars: avgLove != null ? toStars(avgLove) : null,
        pickCount: pr.count,
        pickIds: pr.pickIds,
      };
    });
    const hasLove = pickerLeaderboard.some(p => p.avgLove != null);
    pickerLeaderboard.sort((a, b) => {
      if (hasLove) {
        const av = a.avgLove ?? -1, bv = b.avgLove ?? -1;
        if (bv !== av) return bv - av;
      }
      return b.pickCount - a.pickCount;
    });

    return {
      total,
      decadeRows,
      genreRows,
      langRows,
      countryRows,
      actorRows,
      directorRows,
      companyRows,
      pickerRows,
      pickerLeaderboard,
      pickersRankedByLove: hasLove,
      totalRuntime,
      runtimeCount,
      longest,
      shortest,
      highestRated,
      lowestRated,
      avgRating: ratingCount > 0 ? ratingSum / ratingCount : null,
      oldest,
      newest,
      avgYear,
      medianYear,
      tasteDecadeRows,
      tasteMembers,
      pickLove,
    };
  }, [movieEntries, tmdbDetails, profiles, rankings]);

  if (loading) return <StatsSkeleton />;

  if (picks.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="text-center py-20"
      >
        <div className="relative inline-block mb-5">
          <div className="absolute inset-0 blur-2xl bg-primary/15 scale-150 rounded-full" />
          <div className="relative w-16 h-16 rounded-2xl bg-muted/50 border border-border/50 flex items-center justify-center">
            <BarChart3 className="w-8 h-8 text-muted-foreground/40" />
          </div>
        </div>
        <p className="font-display text-lg font-semibold text-muted-foreground">No stats yet</p>
        <p className="text-sm text-muted-foreground/60 mt-1">
          Stats appear once {labels.items} have been {labels.watched}
        </p>
      </motion.div>
    );
  }

  const maxDecade = Math.max(1, ...stats.decadeRows.map(r => r.count));
  const maxGenre = Math.max(1, ...stats.genreRows.map(r => r.count));
  const maxLang = Math.max(1, ...stats.langRows.map(r => r.count));
  const maxCountry = Math.max(1, ...stats.countryRows.map(r => r.count));

  const openDrill = (title: string, pickIds: string[], mode: 'default' | 'decade' = 'default') => {
    if (pickIds.length === 0) return;
    if (pickIds.length === 1) {
      setSelectedPickId(pickIds[0]);
      setDrill({ title, pickIds, mode });
    } else {
      setDrill({ title, pickIds, mode });
      setSelectedPickId(null);
    }
  };

  const decadeCount = stats.decadeRows.length;
  const yearTimelinePct = stats.oldest && stats.newest && stats.avgYear != null && stats.newest.y > stats.oldest.y
    ? Math.round(((stats.avgYear - stats.oldest.y) / (stats.newest.y - stats.oldest.y)) * 100)
    : 50;

  const records = !isBookClub ? [
    stats.highestRated && { key: 'high', tag: 'Highest rated', accent: 'text-primary', pid: stats.highestRated.pickId, val: stats.highestRated.rating.toFixed(1), valIcon: '★ ' },
    stats.longest && { key: 'long', tag: 'Longest', accent: 'text-sky-400', pid: stats.longest.pickId, val: formatRuntime(stats.longest.runtime) },
    stats.shortest && { key: 'short', tag: 'Shortest', accent: 'text-emerald-400', pid: stats.shortest.pickId, val: formatRuntime(stats.shortest.runtime) },
    stats.lowestRated && { key: 'low', tag: 'Lowest rated', accent: 'text-rose-400', pid: stats.lowestRated.pickId, val: stats.lowestRated.rating.toFixed(1), valIcon: '★ ' },
    stats.oldest && { key: 'old', tag: 'Oldest', accent: 'text-violet-400', pid: stats.oldest.p.id, val: `${stats.oldest.y}` },
    stats.newest && { key: 'new', tag: 'Newest', accent: 'text-amber-400', pid: stats.newest.p.id, val: `${stats.newest.y}` },
  ].filter(Boolean) as { key: string; tag: string; accent: string; pid: string; val: string; valIcon?: string }[] : [];

  const onShare = () => {
    const groupName = group.name || 'Our movie club';
    share({
      title: `${groupName} — club stats`,
      text: `${groupName} watched ${stats.total} ${labels.items} across ${decadeCount} decade${decadeCount === 1 ? '' : 's'}${!isBookClub && stats.runtimeCount > 0 ? ` — ${formatRuntime(stats.totalRuntime)} together` : ''}.`,
      url: typeof window !== 'undefined' ? window.location.href : undefined,
    });
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      {/* HERO — recap + share (span 2) */}
      <Tile span2 index={0} className="relative overflow-hidden bg-gradient-to-br from-primary/[0.14] to-transparent border-primary/25">
        <div className="flex items-start justify-between gap-3">
          <button onClick={() => openDrill(`All ${labels.items}`, movieEntries.map(e => e.canonical.id))} className="text-left flex-1 min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{group.name || 'Club'} · Stats</p>
            <div className="flex items-end gap-3 mt-1.5">
              <span className="font-display text-5xl sm:text-6xl font-bold text-gradient-gold leading-none">{stats.total}</span>
              <span className="text-sm font-semibold pb-1.5 leading-tight">
                {labels.items} {labels.watched}
                <span className="block text-[11px] font-normal text-muted-foreground mt-0.5">
                  across {decadeCount} decade{decadeCount === 1 ? '' : 's'}{!isBookClub && stats.runtimeCount > 0 ? ` · ${formatRuntime(stats.totalRuntime)} together` : ''}
                </span>
              </span>
            </div>
          </button>
          <Button variant="outline" size="sm" onClick={onShare} disabled={sharing} className="shrink-0 h-8 rounded-full border-primary/30 text-primary hover:bg-primary/10">
            <Share2 className="w-3.5 h-3.5 sm:mr-1.5" /> <span className="hidden sm:inline">Share</span>
          </Button>
        </div>
      </Tile>

      {/* Runtime + Avg rating (movie-only) */}
      {!isBookClub && (
        <Tile index={1} label="Total runtime">
          <div className="font-display text-2xl font-bold mt-1.5">{stats.runtimeCount > 0 ? formatRuntime(stats.totalRuntime) : '—'}</div>
          {stats.runtimeCount > 0 && stats.runtimeCount < stats.total && (
            <p className="text-[10px] text-muted-foreground mt-1">from {stats.runtimeCount}/{stats.total}</p>
          )}
        </Tile>
      )}
      {!isBookClub && (
        <Tile index={2} label="Avg TMDB">
          <div className="flex items-baseline gap-1 mt-1.5">
            <span className="font-display text-2xl font-bold text-gradient-gold">{stats.avgRating != null ? stats.avgRating.toFixed(1) : '—'}</span>
            {stats.avgRating != null && <span className="text-xs text-muted-foreground font-medium">/10</span>}
          </div>
          {stats.avgRating != null && <div className="mt-1.5"><StarRating avg={stats.avgRating / 10} size={12} /></div>}
        </Tile>
      )}

      {/* Year range (span 2) with timeline */}
      <Tile span2={isBookClub} index={3} label="Year range">
        <div className="flex items-baseline justify-between gap-2 mt-1.5">
          <span className="font-display text-2xl font-bold">
            {stats.oldest && stats.newest ? `${stats.oldest.y}–${stats.newest.y}` : '—'}
          </span>
          {stats.avgYear != null && (
            <span className="text-[10px] text-muted-foreground rounded-full bg-muted/40 px-2 py-0.5">avg <span className="text-primary font-semibold">{stats.avgYear}</span></span>
          )}
        </div>
        {stats.oldest && stats.newest && stats.newest.y > stats.oldest.y && (
          <div className="relative h-1.5 rounded-full bg-muted/30 mt-3 overflow-visible">
            <div className="absolute inset-0 rounded-full bg-gradient-to-r from-violet-500/50 via-primary to-sky-500/60" />
            <div className="absolute -top-[3px] w-3 h-3 rounded-full bg-primary border-2 border-card" style={{ left: `calc(${yearTimelinePct}% - 6px)` }} />
          </div>
        )}
      </Tile>

      {/* By decade (span 2) */}
      {stats.decadeRows.length > 0 && (
        <Tile span2 index={4} label="By decade" onClick={undefined}>
          <div className="space-y-1 mt-1">
            {stats.decadeRows.map((r, i) => (
              <BarRow key={r.key} label={r.label} count={r.count} max={maxDecade} index={i}
                onClick={() => openDrill(`${r.label}`, r.pickIds)} />
            ))}
          </div>
        </Tile>
      )}

      {/* TOP PICKERS leaderboard (span 2) */}
      {stats.pickerLeaderboard.length > 0 && (
        <Tile span2 index={5} label="Top pickers" labelRight={stats.pickersRankedByLove ? 'most loved' : 'by volume'} labelIcon={<Trophy className="w-3 h-3 text-primary" />}>
          <div className="space-y-1 mt-1.5">
            {stats.pickerLeaderboard.slice(0, 7).map((p, i) => {
              const medal = i === 0 ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/40'
                : i === 1 ? 'bg-slate-300/15 text-slate-200 ring-1 ring-slate-300/30'
                : i === 2 ? 'bg-amber-700/25 text-amber-500 ring-1 ring-amber-700/40'
                : 'bg-muted/40 text-muted-foreground';
              return (
                <button key={p.user_id} onClick={() => openDrill(p.name, p.pickIds)}
                  className={`w-full flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-primary/[0.06] ${i === 0 ? 'bg-primary/[0.06]' : ''}`}>
                  <span className={`relative w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold tabular-nums shrink-0 ${medal}`}>
                    {i + 1}
                    {i === 0 && <Crown className="w-3 h-3 text-amber-300 absolute -top-2.5 left-1/2 -translate-x-1/2" />}
                  </span>
                  <Avatar profile={getProfile(p.user_id)} size={26} />
                  <span className={`flex-1 min-w-0 truncate text-sm ${i === 0 ? 'font-bold' : 'font-medium'}`}>{p.name}</span>
                  {p.stars != null ? (
                    <span className="flex items-center gap-1.5 shrink-0">
                      <StarRating avg={p.stars / 5} size={11} />
                      <span className="text-xs font-semibold text-primary tabular-nums w-7 text-right">{p.stars.toFixed(1)}</span>
                    </span>
                  ) : (
                    <span className="text-xs font-semibold text-primary tabular-nums shrink-0">{p.pickCount}</span>
                  )}
                  <span className="text-[10px] text-muted-foreground shrink-0 w-10 text-right">{p.pickCount} pick{p.pickCount === 1 ? '' : 's'}</span>
                </button>
              );
            })}
          </div>
          {stats.pickersRankedByLove && (
            <p className="text-[10px] text-muted-foreground/70 mt-2 pl-1">★ = how high the club ranked their picks</p>
          )}
        </Tile>
      )}

      {/* Taste by decade (span 2) */}
      {stats.tasteDecadeRows.length > 0 && (
        <Tile span2 index={6} label="Taste by decade" labelRight="avg ★ per decade" labelIcon={<Star className="w-3 h-3 text-primary" />}>
          <div className="mt-1">
            <TasteByDecade
              overall={stats.tasteDecadeRows}
              members={stats.tasteMembers}
              profiles={profiles}
              onSelectDecade={(r) => openDrill(r.label, r.pickIds, 'decade')}
            />
          </div>
        </Tile>
      )}

      {/* Movie-only tiles */}
      {!isBookClub && (
        <>
          {/* Genres */}
          {stats.genreRows.length > 0 && (
            <Tile span2 index={7} label="Top genres" labelRight={enrichLoading ? 'loading…' : undefined} labelIcon={<Tag className="w-3 h-3 text-primary" />}>
              <div className="space-y-1 mt-1">
                {stats.genreRows.slice(0, 8).map((r, i) => (
                  <BarRow key={r.key} label={r.label} count={r.count} max={maxGenre} index={i}
                    onClick={() => openDrill(r.label, r.pickIds)} />
                ))}
              </div>
            </Tile>
          )}

          {/* Languages */}
          {stats.langRows.length > 0 && (
            <Tile index={8} label="Languages" labelIcon={<Languages className="w-3 h-3 text-primary" />}>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {stats.langRows.slice(0, 6).map(r => (
                  <button key={r.key} onClick={() => openDrill(r.label, r.pickIds)}
                    className="inline-flex items-center gap-1 rounded-full bg-muted/40 border border-border/40 px-2 py-0.5 text-[11px] font-medium hover:border-primary/30 transition-colors">
                    {r.label} <span className="text-primary font-semibold">{r.count}</span>
                  </button>
                ))}
              </div>
            </Tile>
          )}

          {/* Countries */}
          {stats.countryRows.length > 0 && (
            <Tile index={8} label="Countries" labelIcon={<Globe className="w-3 h-3 text-primary" />}>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {stats.countryRows.slice(0, 6).map(r => (
                  <button key={r.key} onClick={() => openDrill(r.label, r.pickIds)}
                    className="inline-flex items-center gap-1 rounded-full bg-muted/40 border border-border/40 px-2 py-0.5 text-[11px] font-medium hover:border-primary/30 transition-colors">
                    {r.label} <span className="text-primary font-semibold">{r.count}</span>
                  </button>
                ))}
              </div>
            </Tile>
          )}

          {/* Actors */}
          {stats.actorRows.length > 0 && (
            <Tile span2 index={9} label="Recurring cast" labelRight={enrichLoading ? 'loading…' : `${stats.actorRows.length} unique`} labelIcon={<Users className="w-3 h-3 text-primary" />}>
              <div className="mt-2">
                <ActorGrid actors={stats.actorRows} onSelect={(a) => openDrill(a.label, a.pickIds)} />
              </div>
            </Tile>
          )}

          {/* Directors */}
          {stats.directorRows.length > 0 && (
            <Tile span2 index={10} label="Directors" labelRight={enrichLoading ? 'loading…' : `${stats.directorRows.length} unique`} labelIcon={<Clapperboard className="w-3 h-3 text-primary" />}>
              <div className="mt-2">
                <ActorGrid actors={stats.directorRows} onSelect={(a) => openDrill(a.label, a.pickIds)} noun="director" pluralNoun="directors" />
              </div>
            </Tile>
          )}

          {/* Studios */}
          {stats.companyRows.length > 0 && (
            <Tile span2 index={11} label="Production companies" labelRight={enrichLoading ? 'loading…' : `${stats.companyRows.length} unique`} labelIcon={<Building2 className="w-3 h-3 text-primary" />}>
              <div className="mt-2">
                <ActorGrid actors={stats.companyRows} onSelect={(a) => openDrill(a.label, a.pickIds)} noun="studio" pluralNoun="studios" variant="logo" />
              </div>
            </Tile>
          )}

          {/* Records strip (span 2) */}
          {records.length > 0 && (
            <Tile span2 index={12} label="Records" labelRight="tap to explore →" labelIcon={<Trophy className="w-3 h-3 text-primary" />}>
              <div className="flex gap-2.5 overflow-x-auto pb-1 mt-2 -mx-1 px-1">
                {records.map(rec => {
                  const entry = pickIdToEntry.get(rec.pid);
                  const p = entry?.canonical;
                  return (
                    <button key={rec.key} onClick={() => openDrill(rec.tag, [rec.pid])}
                      className="shrink-0 w-[120px] rounded-xl bg-card/40 border border-border/40 p-2 text-left hover:border-primary/30 transition-colors">
                      <p className={`text-[9px] font-bold uppercase tracking-wider mb-1.5 ${rec.accent}`}>{rec.tag}</p>
                      <div className="flex gap-2">
                        <div className="w-8 h-12 rounded-md overflow-hidden bg-muted shrink-0 ring-1 ring-border/30">
                          {p?.poster_url ? <img src={p.poster_url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><Film className="w-3 h-3 text-muted-foreground" /></div>}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold leading-tight line-clamp-2">{p?.title || '—'}</p>
                          <p className={`text-xs font-bold mt-1 ${rec.accent}`}>{rec.valIcon}{rec.val}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Tile>
          )}

          {/* Coverage footer */}
          <p className="col-span-2 text-center text-[11px] text-muted-foreground/70 pt-1">
            TMDB details loaded for {Object.keys(tmdbDetails).length}/{stats.total} {labels.items}{enrichLoading ? ' · still fetching…' : ''}
          </p>
        </>
      )}

      {/* Drill-down dialog */}
      <Dialog
        open={drill !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDrill(null);
            setSelectedPickId(null);
          }
        }}
      >
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedPickId && drill && drill.pickIds.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 -ml-1"
                  onClick={() => setSelectedPickId(null)}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
              )}
              <span>
                {selectedPickId && drill && drill.pickIds.length > 1
                  ? pickIdToEntry.get(selectedPickId)?.canonical.title
                  : drill?.title}
                {!selectedPickId && drill && drill.pickIds.length > 1 && (
                  <span className="text-muted-foreground text-sm font-normal ml-2">
                    · {drill.pickIds.length} {labels.items}
                  </span>
                )}
              </span>
            </DialogTitle>
          </DialogHeader>

          {drill && !selectedPickId && drill.pickIds.length > 1 && drill.mode !== 'decade' && (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 pt-2">
              {drill.pickIds.map((pid, i) => {
                const entry = pickIdToEntry.get(pid);
                if (!entry) return null;
                const p = entry.canonical;
                return (
                  <motion.button
                    key={pid}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.25, delay: i * 0.03, ease: [0.16, 1, 0.3, 1] }}
                    onClick={() => setSelectedPickId(pid)}
                    className="text-left group"
                  >
                    <div className="aspect-[2/3] rounded-md overflow-hidden bg-muted ring-1 ring-border/30 group-hover:ring-primary/40 transition-all">
                      {p.poster_url ? (
                        <img src={p.poster_url} alt={p.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Film className="w-5 h-5 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] mt-1 line-clamp-2 leading-tight min-h-[2.2em] group-hover:text-primary transition-colors">{p.title}</p>
                  </motion.button>
                );
              })}
            </div>
          )}

          {drill && !selectedPickId && drill.pickIds.length > 1 && drill.mode === 'decade' && (
            <div className="space-y-2 pt-2">
              <p className="text-xs text-muted-foreground">Sorted by group ranking · highest rated first</p>
              {drill.pickIds
                .map(pid => {
                  const entry = pickIdToEntry.get(pid);
                  const love = stats.pickLove.get(pid);
                  return { pid, entry, avg: love ? love.sum / love.count : null, count: love?.count ?? 0 };
                })
                .filter(x => x.entry)
                .sort((a, b) => {
                  if (a.avg == null && b.avg == null) return 0;
                  if (a.avg == null) return 1;
                  if (b.avg == null) return -1;
                  return b.avg - a.avg;
                })
                .map(({ pid, entry, avg, count }, i) => {
                  const p = entry!.canonical;
                  return (
                    <motion.button
                      key={pid}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.25, delay: i * 0.04, ease: [0.16, 1, 0.3, 1] }}
                      onClick={() => setSelectedPickId(pid)}
                      className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-primary/5 hover:ring-1 hover:ring-primary/20 transition-all text-left"
                    >
                      <div className="w-12 aspect-[2/3] rounded overflow-hidden bg-muted shrink-0">
                        {p.poster_url ? (
                          <img src={p.poster_url} alt={p.title} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Film className="w-4 h-4 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium line-clamp-1">{p.title}</p>
                        {avg != null ? (
                          <div className="flex items-center gap-2 mt-1">
                            <StarRating avg={avg} size={14} />
                            <span className="text-sm font-semibold tabular-nums">{toStars(avg).toFixed(1)}</span>
                            <span className="text-[11px] text-muted-foreground">· {count} {count === 1 ? 'rank' : 'ranks'}</span>
                          </div>
                        ) : (
                          <p className="text-[11px] text-muted-foreground mt-1">No rankings yet</p>
                        )}
                      </div>
                    </motion.button>
                  );
                })}
            </div>
          )}

          {selectedPickId && (
            <MovieDetailView
              entry={pickIdToEntry.get(selectedPickId)!}
              guesses={guesses}
              rankings={rankings}
              members={members}
              getName={getName}
              getProfile={getProfile}
              tmdb={tmdbDetails[selectedPickId]}
              seasons={seasons}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ── Movie detail view ─────────────────────────────────────────────────────────

const MovieDetailView = ({
  entry,
  guesses,
  rankings,
  members,
  getName,
  getProfile,
  tmdb,
  seasons,
}: {
  entry: { canonical: PickRow; pickerIds: string[]; siblingPickIds: string[] };
  guesses: GuessRow[];
  rankings: RankingRow[];
  members: { user_id: string }[];
  getName: (uid: string) => string;
  getProfile: (uid: string) => Profile | undefined;
  tmdb?: TmdbDetails;
  seasons: SeasonInfo[];
}) => {
  const p = entry.canonical;
  const season = seasons.find(s => s.id === p.season_id);
  const validPickerIds = new Set(entry.pickerIds);
  const siblingSet = new Set(entry.siblingPickIds);

  const guessByUser = new Map<string, GuessRow>();
  for (const g of guesses) {
    if (siblingSet.has(g.movie_pick_id) && !guessByUser.has(g.guesser_id)) {
      guessByUser.set(g.guesser_id, g);
    }
  }

  const rankByUser = new Map<string, number>();
  for (const r of rankings) {
    if (siblingSet.has(r.movie_pick_id) && !rankByUser.has(r.user_id)) {
      rankByUser.set(r.user_id, r.rank);
    }
  }

  const guessRows = members
    .filter(m => !validPickerIds.has(m.user_id))
    .map(m => ({
      uid: m.user_id,
      name: getName(m.user_id),
      guess: guessByUser.get(m.user_id),
    }));

  const rankRows = members
    .map(m => ({
      uid: m.user_id,
      name: getName(m.user_id),
      rank: rankByUser.get(m.user_id),
    }))
    .filter(r => r.rank != null)
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));

  const yearText = tmdb?.release_date?.slice(0, 4) || p.year || '';

  return (
    <div className="space-y-4 pt-1 min-w-0">
      <div className="flex gap-4">
        {/* Poster with ambient glow */}
        <div className="relative shrink-0">
          {p.poster_url && (
            <div className="absolute inset-0 blur-2xl bg-primary/20 scale-125 -z-10 rounded-xl" />
          )}
          <div className="w-24 aspect-[2/3] rounded-xl overflow-hidden bg-muted ring-1 ring-border/40">
            {p.poster_url ? (
              <img src={p.poster_url} alt={p.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Film className="w-6 h-6 text-muted-foreground" />
              </div>
            )}
          </div>
        </div>
        <div className="flex-1 min-w-0 text-sm space-y-1.5">
          <div className="font-display font-semibold text-base leading-snug">{p.title}</div>
          <div className="text-muted-foreground text-xs">
            {[yearText, tmdb?.runtime ? formatRuntime(tmdb.runtime) : null, tmdb?.vote_average ? `★ ${tmdb.vote_average.toFixed(1)}` : null]
              .filter(Boolean)
              .join(' · ')}
          </div>
          {season && (
            <div className="text-[11px] text-muted-foreground">
              Season {season.season_number}{season.title ? ` — ${season.title}` : ''}
            </div>
          )}
          {tmdb?.directors && tmdb.directors.length > 0 && (
            <div className="text-[11px] text-muted-foreground">
              Dir. {tmdb.directors.map(d => d.name).join(', ')}
            </div>
          )}
          {tmdb?.genres && tmdb.genres.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {tmdb.genres.map(g => (
                <span key={g.id} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 border border-primary/15 text-primary">
                  {g.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pickers */}
      <div className="space-y-1.5">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Picked by</div>
        <div className="flex flex-wrap gap-2">
          {entry.pickerIds.map(uid => (
            <div key={uid} className="flex items-center gap-1.5 text-sm bg-primary/10 border border-primary/20 rounded-full px-2 py-1">
              <Avatar profile={getProfile(uid)} size={20} />
              <span>{getName(uid)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Cast */}
      {tmdb?.cast && tmdb.cast.length > 0 && (
        <div className="space-y-1.5 min-w-0">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Top cast</div>
          <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6 pb-1">
            <div className="flex gap-2 w-max">
              {tmdb.cast.slice(0, 10).map(c => (
                <div key={c.id} className="shrink-0 w-16 text-center">
                  <div className="aspect-[2/3] rounded-md overflow-hidden bg-muted">
                    {c.profile_path ? (
                      <img
                        src={`https://image.tmdb.org/t/p/w185${c.profile_path}`}
                        alt={c.name}
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Users className="w-4 h-4 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] mt-1 line-clamp-2 leading-tight">{c.name}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Guesses */}
      {guessRows.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Guesses</div>
          <ul className="text-sm divide-y divide-border/40 rounded-lg border border-border/40 overflow-hidden">
            {guessRows.map(r => {
              const correct = r.guess && validPickerIds.has(r.guess.guessed_user_id);
              return (
                <li key={r.uid} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Avatar profile={getProfile(r.uid)} size={20} />
                    <span>{r.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    {r.guess ? (
                      <>
                        <span className="text-muted-foreground">guessed</span>
                        <span className="font-medium">{getName(r.guess.guessed_user_id)}</span>
                        {correct ? (
                          <Check className="w-4 h-4 text-emerald-500" />
                        ) : (
                          <X className="w-4 h-4 text-muted-foreground" />
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground italic">no guess</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Rankings */}
      {rankRows.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <TrophyIcon className="w-3 h-3" /> Rankings
          </div>
          <ul className="text-sm divide-y divide-border/40 rounded-lg border border-border/40 overflow-hidden">
            {rankRows.map(r => (
              <li key={r.uid} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Avatar profile={getProfile(r.uid)} size={20} />
                  <span>{r.name}</span>
                </div>
                <span className="text-xs font-medium tabular-nums">#{r.rank}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

// ── Taste by decade ───────────────────────────────────────────────────────────

type TasteRow = { decade: number; label: string; avg: number; count: number; pickIds: string[] };
type TasteMember = {
  user_id: string;
  name: string;
  rows: TasteRow[];
  favorite?: TasteRow;
  least?: TasteRow;
};

const TasteByDecade = ({
  overall,
  members,
  profiles,
  onSelectDecade,
}: {
  overall: TasteRow[];
  members: TasteMember[];
  profiles: Profile[];
  onSelectDecade?: (row: TasteRow) => void;
}) => {
  const [tab, setTab] = useState<'overall' | 'members'>('overall');

  return (
    <div className="space-y-3">
      {/* Tab switcher — matches the dashboard tab style */}
      <div className="flex gap-0 border-b border-border/40 -mx-1">
        {(['overall', 'members'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors capitalize ${
              tab === t
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'members' ? 'Per member' : 'Overall'}
          </button>
        ))}
      </div>

      {tab === 'overall' && (
        <div className="space-y-1.5">
          {overall.map((r, i) => {
            const inner = (
              <>
                <div className="w-16 text-xs sm:text-sm text-left">{r.label}</div>
                <div className="flex-1">
                  <StarRating avg={r.avg} size={16} />
                </div>
                <div className="w-10 text-right text-xs font-medium tabular-nums">
                  {toStars(r.avg).toFixed(1)}
                </div>
              </>
            );
            return onSelectDecade && r.pickIds.length > 0 ? (
              <button
                key={r.decade}
                onClick={() => onSelectDecade(r)}
                className="w-full flex items-center gap-3 rounded-md px-1 -mx-1 py-1.5 hover:bg-primary/5 transition-colors"
              >
                {inner}
              </button>
            ) : (
              <div key={r.decade} className="flex items-center gap-3 px-1 py-1.5">
                {inner}
              </div>
            );
          })}
          <p className="text-[11px] text-muted-foreground pt-1">
            Stars = avg of how high the club ranked picks from each decade.
          </p>
        </div>
      )}

      {tab === 'members' && (
        <div className="space-y-4">
          {members.length === 0 && (
            <p className="text-sm text-muted-foreground">Not enough rankings yet.</p>
          )}
          {members.map(m => {
            const profile = profiles.find(p => p.user_id === m.user_id);
            const initial = (profile?.display_name || '?').slice(0, 1).toUpperCase();
            return (
              <div key={m.user_id} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center overflow-hidden text-[10px] font-semibold text-primary shrink-0">
                    {profile?.avatar_url ? (
                      <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : initial}
                  </div>
                  <div className="text-sm font-medium">{m.name}</div>
                  {m.favorite && m.least && m.favorite.decade !== m.least.decade && (
                    <div className="text-[11px] text-muted-foreground ml-auto">
                      ❤ {m.favorite.label} · ✗ {m.least.label}
                    </div>
                  )}
                </div>
                <div className="space-y-1 pl-8">
                  {m.rows.map(r => {
                    const inner = (
                      <>
                        <div className="w-12 text-[11px] text-muted-foreground text-left">{r.label}</div>
                        <div className="flex-1">
                          <StarRating avg={r.avg} size={13} />
                        </div>
                        <div className="w-8 text-right text-[11px] tabular-nums">
                          {toStars(r.avg).toFixed(1)}
                        </div>
                        <div className="w-6 text-right text-[10px] text-muted-foreground tabular-nums">
                          ({r.count})
                        </div>
                      </>
                    );
                    return onSelectDecade && r.pickIds.length > 0 ? (
                      <button
                        key={r.decade}
                        onClick={() => onSelectDecade(r)}
                        className="w-full flex items-center gap-2 rounded-md px-1 -mx-1 py-1 hover:bg-primary/5 transition-colors"
                      >
                        {inner}
                      </button>
                    ) : (
                      <div key={r.decade} className="flex items-center gap-2 px-1 py-1">
                        {inner}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── Actor / Director / Company grid ──────────────────────────────────────────

type GridItem = {
  id: number;
  label: string;
  profile_path?: string | null;
  logo_path?: string | null;
  count: number;
  pickIds: string[];
  popularity?: number;
};

const ActorGrid = ({
  actors,
  onSelect,
  noun = 'actor',
  pluralNoun = 'actors',
  itemNoun = 'movie',
  itemPluralNoun = 'movies',
  variant = 'portrait',
}: {
  actors: GridItem[];
  onSelect: (a: GridItem) => void;
  noun?: string;
  pluralNoun?: string;
  itemNoun?: string;
  itemPluralNoun?: string;
  variant?: 'portrait' | 'logo';
}) => {
  const [showAll, setShowAll] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  const repeats = actors.filter(a => a.count >= 2);
  const headline = repeats.length > 0 ? repeats : actors.slice(0, 12);
  const list = showAll ? actors : headline;

  const handleCollapse = () => {
    setShowAll(false);
    requestAnimationFrame(() => {
      topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const isLogo = variant === 'logo';

  return (
    <div className="space-y-3" ref={topRef}>
      {repeats.length > 0 && !showAll && (
        <p className="text-[11px] text-muted-foreground">
          {repeats.length} {repeats.length === 1 ? `${noun} appears` : `${pluralNoun} appear`} in multiple {repeats.length === 1 ? itemNoun : itemPluralNoun}.
        </p>
      )}
      {showAll && actors.length > headline.length && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            Showing all {actors.length} {actors.length === 1 ? noun : pluralNoun}
          </p>
          <Button variant="ghost" size="sm" onClick={handleCollapse} className="text-xs h-7">
            Show less
          </Button>
        </div>
      )}
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
        {list.map((a, i) => {
          const img = a.profile_path ?? a.logo_path ?? null;
          return (
            <motion.button
              key={a.id}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.28, delay: Math.min(i * 0.03, 0.5), ease: [0.16, 1, 0.3, 1] }}
              onClick={() => onSelect(a)}
              className="text-left group"
            >
              <div className={`${isLogo ? 'aspect-square p-3 flex items-center justify-center' : 'aspect-[2/3]'} rounded-md overflow-hidden bg-muted relative ring-1 ring-border/20 group-hover:ring-primary/30 transition-all`}>
                {img ? (
                  <img
                    src={`https://image.tmdb.org/t/p/w185${img}`}
                    alt={a.label}
                    loading="lazy"
                    className={isLogo
                      ? 'max-w-full max-h-full object-contain'
                      : 'w-full h-full object-cover group-hover:scale-105 transition-transform duration-300'}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    {isLogo
                      ? <Building2 className="w-6 h-6 text-muted-foreground" />
                      : <Users className="w-6 h-6 text-muted-foreground" />}
                  </div>
                )}
                {a.count >= 2 && (
                  <span className="absolute top-1 right-1 text-[10px] font-semibold bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 shadow-sm">
                    ×{a.count}
                  </span>
                )}
              </div>
              <p className="text-[11px] mt-1 line-clamp-2 leading-tight min-h-[2.2em] group-hover:text-primary transition-colors">
                {a.label}
              </p>
            </motion.button>
          );
        })}
      </div>
      {actors.length > headline.length && (
        <div className="flex justify-center pt-1">
          <Button variant="ghost" size="sm" onClick={() => setShowAll(s => !s)} className="text-xs">
            {showAll ? 'Show less' : `Show all ${actors.length}`}
          </Button>
        </div>
      )}
    </div>
  );
};

// ── Small UI primitives ───────────────────────────────────────────────────────

const Avatar = ({ profile, size = 24 }: { profile?: Profile; size?: number }) => {
  const initial = (profile?.display_name || '?').slice(0, 1).toUpperCase();
  return (
    <div
      className="rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center overflow-hidden text-[10px] font-semibold text-primary shrink-0"
      style={{ width: size, height: size }}
    >
      {profile?.avatar_url ? (
        <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
      ) : initial}
    </div>
  );
};

// ── Bento tile ────────────────────────────────────────────────────────────────
const Tile = ({
  children, label, labelRight, labelIcon, span2 = false, onClick, index = 0, className = '',
}: {
  children: React.ReactNode;
  label?: string;
  labelRight?: string;
  labelIcon?: React.ReactNode;
  span2?: boolean;
  onClick?: () => void;
  index?: number;
  className?: string;
}) => {
  const motionProps = {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.35, delay: Math.min(index * 0.05, 0.5), ease: [0.16, 1, 0.3, 1] as const },
  };
  const header = label && (
    <div className="flex items-center justify-between gap-2 mb-0.5">
      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {labelIcon}{label}
      </span>
      {labelRight && <span className="text-[10px] text-muted-foreground/70">{labelRight}</span>}
    </div>
  );
  const base = `glass-card rounded-2xl p-3.5 sm:p-4 ${span2 ? 'col-span-2' : ''} ${className}`;
  if (onClick) {
    return (
      <motion.button {...motionProps} onClick={onClick}
        className={`${base} text-left w-full hover:ring-1 hover:ring-primary/40 hover:bg-primary/5 transition-all duration-200`}>
        {header}{children}
      </motion.button>
    );
  }
  return (
    <motion.div {...motionProps} className={base}>
      {header}{children}
    </motion.div>
  );
};

const BarRow = ({
  label, count, max, onClick, index = 0,
}: { label: string; count: number; max: number; onClick?: () => void; index?: number }) => {
  const pct = (count / max) * 100;
  const bar = (
    <div className="flex-1 h-2 bg-muted/40 rounded-full overflow-hidden">
      <motion.div
        className="h-full bg-gradient-to-r from-primary/70 to-primary rounded-full"
        initial={{ width: '0%' }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.65, delay: index * 0.045, ease: [0.16, 1, 0.3, 1] }}
      />
    </div>
  );
  const content = (
    <>
      <div className="w-24 sm:w-32 text-xs sm:text-sm truncate text-left">{label}</div>
      {bar}
      <div className="w-8 text-right text-xs sm:text-sm font-medium tabular-nums">{count}</div>
    </>
  );
  if (onClick) {
    return (
      <button
        onClick={onClick}
        className="w-full flex items-center gap-3 rounded-md px-1 -mx-1 py-1.5 hover:bg-primary/5 transition-colors"
      >
        {content}
      </button>
    );
  }
  return <div className="flex items-center gap-3 px-1 py-1.5">{content}</div>;
};

export default Stats;
