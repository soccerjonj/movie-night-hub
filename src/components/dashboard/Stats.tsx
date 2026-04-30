import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Profile } from '@/hooks/useGroup';
import { Film, Clock, Star, Globe, Calendar, Tag, Trophy, BarChart3, Languages, BookOpen, ChevronLeft, Check, X, Trophy as TrophyIcon, Users, Clapperboard, Building2 } from 'lucide-react';
import { TMDB_API_TOKEN } from '@/lib/apiKeys';
import { getClubLabels } from '@/lib/clubTypes';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

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
  genres: { id: number; name: string }[];
  original_language: string | null;
  production_countries: { iso_3166_1: string; name: string }[];
  cast?: CastMember[];
  directors?: CrewMember[];
  production_companies?: ProductionCompany[];
}

const TMDB_CACHE_KEY = 'mc_tmdb_details_v5';

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
                <Star
                  className="text-primary fill-primary"
                  style={{ width: size, height: size }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

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
    // Each entry — pick first as canonical, but list all picker user_ids
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
    // For categorization, collapse to canonical pick per movie-entry to avoid double-counting co-picks.
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
      for (const g of det.genres) {
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
      for (const c of det.production_countries) {
        if (!countryMap.has(c.name)) countryMap.set(c.name, []);
        countryMap.get(c.name)!.push(p.id);
      }
    }
    const countryRows = Array.from(countryMap.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .map(([name, ids]) => ({ key: name, label: name, count: ids.length, pickIds: ids }));

    // Actors — aggregate top-billed cast across canonical picks
    const actorMap = new Map<number, { name: string; profile_path: string | null; pickIds: string[]; popularity: number }>();
    for (const p of canonicalPicks) {
      const det = tmdbDetails[p.id];
      if (!det?.cast) continue;
      const seen = new Set<number>();
      for (const c of det.cast) {
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
      if (!det?.directors) continue;
      const seen = new Set<number>();
      for (const c of det.directors) {
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
      if (!det?.production_companies) continue;
      const seen = new Set<number>();
      for (const c of det.production_companies) {
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

    // Picker — uses ALL pick rows (so co-picks credit each picker)
    const pickerMap = new Map<string, string[]>(); // user_id -> pick entry canonical ids
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

    // --- Taste by decade -----------------------------------------------------
    // "Love score" = (N - rank + 1) / N within a season (1 = favorite, ~0 = least)
    // Group rankings by season to find N
    const rankingsBySeason = new Map<string, RankingRow[]>();
    for (const r of rankings) {
      if (!rankingsBySeason.has(r.season_id)) rankingsBySeason.set(r.season_id, []);
      rankingsBySeason.get(r.season_id)!.push(r);
    }
    // For each season+user, compute N (their max rank); fall back to count
    const seasonUserMax = new Map<string, number>();
    for (const [seasonId, rs] of rankingsBySeason) {
      const byUser = new Map<string, number[]>();
      for (const r of rs) {
        if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
        byUser.get(r.user_id)!.push(r.rank);
      }
      for (const [uid, ranks] of byUser) {
        seasonUserMax.set(`${seasonId}:${uid}`, Math.max(...ranks));
      }
    }

    // Map pickId -> decade
    const pickDecade = new Map<string, number>();
    for (const p of canonicalPicks) {
      const det = tmdbDetails[p.id];
      const yr = det?.release_date?.slice(0, 4) || p.year || null;
      const dec = decadeOf(yr);
      if (dec != null) pickDecade.set(p.id, dec);
    }
    // Sibling pick IDs share the canonical decade
    const siblingDecade = new Map<string, number>();
    for (const e of movieEntries) {
      const dec = pickDecade.get(e.canonical.id);
      if (dec == null) continue;
      for (const sid of e.siblingPickIds) siblingDecade.set(sid, dec);
    }

    // Overall avg love-score per decade
    type DecadeAgg = { sum: number; count: number };
    const decadeOverall = new Map<number, DecadeAgg>();
    // Per-member avg love-score per decade
    const memberDecade = new Map<string, Map<number, DecadeAgg>>(); // user_id -> decade -> agg
    // Per-canonical-pick avg love-score (across all users)
    const pickLove = new Map<string, DecadeAgg>();
    // Map any sibling pick id → canonical pick id
    const siblingToCanonical = new Map<string, string>();
    for (const e of movieEntries) {
      for (const sid of e.siblingPickIds) siblingToCanonical.set(sid, e.canonical.id);
    }

    for (const r of rankings) {
      const dec = siblingDecade.get(r.movie_pick_id);
      if (dec == null) continue;
      const N = seasonUserMax.get(`${r.season_id}:${r.user_id}`);
      if (!N || N < 2) continue; // need at least 2 to differentiate
      const love = (N - r.rank + 1) / N; // 1 favorite, ~0 least
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

  const maxDecade = Math.max(1, ...stats.decadeRows.map(r => r.count));
  const maxGenre = Math.max(1, ...stats.genreRows.map(r => r.count));
  const maxPicker = Math.max(1, ...stats.pickerRows.map(r => r.count));
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

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Headline cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<Film className="w-4 h-4" />}
          label={`${labels.items} ${labels.watched}`}
          value={stats.total.toString()}
          onClick={() => openDrill(`All ${labels.items}`, movieEntries.map(e => e.canonical.id))}
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
          sub={
            stats.avgYear != null && stats.medianYear != null
              ? `avg ${stats.avgYear} · med ${stats.medianYear}`
              : undefined
          }
        />
      </div>

      {/* Decades */}
      <Section title="By decade" icon={<Calendar className="w-4 h-4" />}>
        {stats.decadeRows.length === 0 ? (
          <Empty />
        ) : (
          <div className="space-y-1.5">
            {stats.decadeRows.map(r => (
              <BarRow key={r.key} label={r.label} count={r.count} max={maxDecade}
                onClick={() => openDrill(`${r.label}`, r.pickIds)} />
            ))}
          </div>
        )}
      </Section>

      {/* Taste by decade */}
      {stats.tasteDecadeRows.length > 0 && (
        <Section title="Taste by decade" icon={<Star className="w-4 h-4" />} sub="Avg star rating per decade">
          <TasteByDecade
            overall={stats.tasteDecadeRows}
            members={stats.tasteMembers}
            profiles={profiles}
            onSelectDecade={(r) => openDrill(r.label, r.pickIds, 'decade')}
          />
        </Section>
      )}

      {/* Movie-only sections */}
      {!isBookClub && (
        <>
          <Section title="By genre" icon={<Tag className="w-4 h-4" />} sub={enrichLoading ? 'Loading TMDB data…' : undefined}>
            {stats.genreRows.length === 0 ? (
              <Empty hint="Pulled from TMDB" />
            ) : (
              <div className="space-y-1.5">
                {stats.genreRows.slice(0, 12).map(r => (
                  <BarRow key={r.key} label={r.label} count={r.count} max={maxGenre}
                    onClick={() => openDrill(r.label, r.pickIds)} />
                ))}
              </div>
            )}
          </Section>

          <div className="grid md:grid-cols-2 gap-4">
            <Section title="Languages" icon={<Languages className="w-4 h-4" />}>
              {stats.langRows.length === 0 ? <Empty /> : (
                <div className="space-y-1.5">
                  {stats.langRows.slice(0, 8).map(r => (
                    <BarRow key={r.key} label={r.label} count={r.count} max={maxLang}
                      onClick={() => openDrill(r.label, r.pickIds)} />
                  ))}
                </div>
              )}
            </Section>
            <Section title="Countries" icon={<Globe className="w-4 h-4" />}>
              {stats.countryRows.length === 0 ? <Empty /> : (
                <div className="space-y-1.5">
                  {stats.countryRows.slice(0, 8).map(r => (
                    <BarRow key={r.key} label={r.label} count={r.count} max={maxCountry}
                      onClick={() => openDrill(r.label, r.pickIds)} />
                  ))}
                </div>
              )}
            </Section>
          </div>

          {/* Actors */}
          <Section
            title="Actors"
            icon={<Users className="w-4 h-4" />}
            sub={enrichLoading ? 'Loading TMDB data…' : (stats.actorRows.length > 0 ? `${stats.actorRows.length} unique` : undefined)}
          >
            {stats.actorRows.length === 0 ? (
              <Empty hint="Top-billed cast pulled from TMDB" />
            ) : (
              <ActorGrid
                actors={stats.actorRows}
                onSelect={(a) => openDrill(a.label, a.pickIds)}
              />
            )}
          </Section>

          {/* Directors */}
          <Section
            title="Directors"
            icon={<Clapperboard className="w-4 h-4" />}
            sub={enrichLoading ? 'Loading TMDB data…' : (stats.directorRows.length > 0 ? `${stats.directorRows.length} unique` : undefined)}
          >
            {stats.directorRows.length === 0 ? (
              <Empty hint="Pulled from TMDB" />
            ) : (
              <ActorGrid
                actors={stats.directorRows}
                onSelect={(a) => openDrill(a.label, a.pickIds)}
                noun="director"
                pluralNoun="directors"
              />
            )}
          </Section>

          {/* Production companies */}
          <Section
            title="Production companies"
            icon={<Building2 className="w-4 h-4" />}
            sub={enrichLoading ? 'Loading TMDB data…' : (stats.companyRows.length > 0 ? `${stats.companyRows.length} unique` : undefined)}
          >
            {stats.companyRows.length === 0 ? (
              <Empty hint="Pulled from TMDB" />
            ) : (
              <ActorGrid
                actors={stats.companyRows}
                onSelect={(a) => openDrill(a.label, a.pickIds)}
                noun="studio"
                pluralNoun="studios"
                variant="logo"
              />
            )}
          </Section>

          <div className="grid md:grid-cols-2 gap-4">
            <Section title="Records" icon={<Trophy className="w-4 h-4" />}>
              <ul className="text-sm space-y-2">
                <RecordRow label="Longest"
                  value={stats.longest ? `${pickIdToEntry.get(stats.longest.pickId)?.canonical.title} · ${formatRuntime(stats.longest.runtime)}` : '—'}
                  onClick={stats.longest ? () => openDrill('Longest', [stats.longest!.pickId]) : undefined} />
                <RecordRow label="Shortest"
                  value={stats.shortest ? `${pickIdToEntry.get(stats.shortest.pickId)?.canonical.title} · ${formatRuntime(stats.shortest.runtime)}` : '—'}
                  onClick={stats.shortest ? () => openDrill('Shortest', [stats.shortest!.pickId]) : undefined} />
                <RecordRow label="Highest rated"
                  value={stats.highestRated ? `${pickIdToEntry.get(stats.highestRated.pickId)?.canonical.title} · ${stats.highestRated.rating.toFixed(1)}` : '—'}
                  onClick={stats.highestRated ? () => openDrill('Highest rated', [stats.highestRated!.pickId]) : undefined} />
                <RecordRow label="Lowest rated"
                  value={stats.lowestRated ? `${pickIdToEntry.get(stats.lowestRated.pickId)?.canonical.title} · ${stats.lowestRated.rating.toFixed(1)}` : '—'}
                  onClick={stats.lowestRated ? () => openDrill('Lowest rated', [stats.lowestRated!.pickId]) : undefined} />
                <RecordRow label="Oldest"
                  value={stats.oldest ? `${stats.oldest.p.title} · ${stats.oldest.y}` : '—'}
                  onClick={stats.oldest ? () => openDrill('Oldest', [stats.oldest!.p.id]) : undefined} />
                <RecordRow label="Newest"
                  value={stats.newest ? `${stats.newest.p.title} · ${stats.newest.y}` : '—'}
                  onClick={stats.newest ? () => openDrill('Newest', [stats.newest!.p.id]) : undefined} />
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

          {drill && !selectedPickId && drill.pickIds.length > 1 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 pt-2">
              {drill.pickIds.map(pid => {
                const entry = pickIdToEntry.get(pid);
                if (!entry) return null;
                const p = entry.canonical;
                return (
                  <button
                    key={pid}
                    onClick={() => setSelectedPickId(pid)}
                    className="text-left group"
                  >
                    <div className="aspect-[2/3] rounded-md overflow-hidden bg-muted">
                      {p.poster_url ? (
                        <img src={p.poster_url} alt={p.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center p-1">
                          <Film className="w-5 h-5 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] mt-1 line-clamp-2 leading-tight min-h-[2.2em] group-hover:text-primary transition-colors">{p.title}</p>
                  </button>
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

// --- Movie detail view -------------------------------------------------------

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

  // Guesses for this movie entry — dedupe per guesser
  const guessByUser = new Map<string, GuessRow>();
  for (const g of guesses) {
    if (siblingSet.has(g.movie_pick_id) && !guessByUser.has(g.guesser_id)) {
      guessByUser.set(g.guesser_id, g);
    }
  }

  // Rankings for this movie entry — combine across sibling picks (each member ranks each pick once)
  const rankByUser = new Map<string, number>();
  for (const r of rankings) {
    if (siblingSet.has(r.movie_pick_id) && !rankByUser.has(r.user_id)) {
      rankByUser.set(r.user_id, r.rank);
    }
  }

  const guessRows = members
    .filter(m => !validPickerIds.has(m.user_id)) // pickers don't guess themselves
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
      <div className="flex gap-3">
        <div className="w-20 shrink-0 aspect-[2/3] rounded-md overflow-hidden bg-muted">
          {p.poster_url ? (
            <img src={p.poster_url} alt={p.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Film className="w-6 h-6 text-muted-foreground" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0 text-sm space-y-1">
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
            <div className="flex flex-wrap gap-1 pt-1">
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

// --- Small UI primitives -----------------------------------------------------

// --- Taste by decade ---------------------------------------------------------

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
      <div className="flex gap-1 p-1 bg-muted/40 rounded-lg w-fit">
        <button
          onClick={() => setTab('overall')}
          className={`text-xs px-3 py-1 rounded-md transition-colors ${tab === 'overall' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
        >
          Overall
        </button>
        <button
          onClick={() => setTab('members')}
          className={`text-xs px-3 py-1 rounded-md transition-colors ${tab === 'members' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
        >
          Per member
        </button>
      </div>

      {tab === 'overall' && (
        <div className="space-y-1.5">
          {overall.map(r => {
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
                className="w-full flex items-center gap-3 rounded-md px-1 -mx-1 py-1 hover:bg-primary/5 transition-colors"
              >
                {inner}
              </button>
            ) : (
              <div key={r.decade} className="flex items-center gap-3 px-1 py-1">
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
  const repeats = actors.filter(a => a.count >= 2);
  const headline = repeats.length > 0 ? repeats : actors.slice(0, 12);
  const list = showAll ? actors : headline;

  const isLogo = variant === 'logo';

  return (
    <div className="space-y-3">
      {repeats.length > 0 && !showAll && (
        <p className="text-[11px] text-muted-foreground">
          {repeats.length} {repeats.length === 1 ? `${noun} appears` : `${pluralNoun} appear`} in multiple {repeats.length === 1 ? itemNoun : itemPluralNoun}.
        </p>
      )}
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
        {list.map(a => {
          const img = a.profile_path ?? a.logo_path ?? null;
          return (
            <button
              key={a.id}
              onClick={() => onSelect(a)}
              className="text-left group"
            >
              <div className={`${isLogo ? 'aspect-square p-3 flex items-center justify-center' : 'aspect-[2/3]'} rounded-md overflow-hidden bg-muted relative`}>
                {img ? (
                  <img
                    src={`https://image.tmdb.org/t/p/w185${img}`}
                    alt={a.label}
                    loading="lazy"
                    className={isLogo
                      ? 'max-w-full max-h-full object-contain'
                      : 'w-full h-full object-cover group-hover:scale-105 transition-transform'}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    {isLogo
                      ? <Building2 className="w-6 h-6 text-muted-foreground" />
                      : <Users className="w-6 h-6 text-muted-foreground" />}
                  </div>
                )}
                {a.count >= 2 && (
                  <span className="absolute top-1 right-1 text-[10px] font-semibold bg-primary text-primary-foreground rounded-full px-1.5 py-0.5">
                    ×{a.count}
                  </span>
                )}
              </div>
              <p className="text-[11px] mt-1 line-clamp-2 leading-tight min-h-[2.2em] group-hover:text-primary transition-colors">
                {a.label}
              </p>
            </button>
          );
        })}
      </div>
      {actors.length > headline.length && (
        <div className="flex justify-center pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAll(s => !s)}
            className="text-xs"
          >
            {showAll ? 'Show less' : `Show all ${actors.length}`}
          </Button>
        </div>
      )}
    </div>
  );
};

const Avatar = ({ profile, size = 24 }: { profile?: Profile; size?: number }) => {
  const initial = (profile?.display_name || '?').slice(0, 1).toUpperCase();
  return (
    <div
      className="rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center overflow-hidden text-[10px] font-semibold text-primary shrink-0"
      style={{ width: size, height: size }}
    >
      {profile?.avatar_url ? (
        <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
      ) : (
        initial
      )}
    </div>
  );
};

const StatCard = ({
  icon, label, value, sub, onClick,
}: { icon: React.ReactNode; label: string; value: string; sub?: string; onClick?: () => void }) => {
  const inner = (
    <>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="text-lg sm:text-2xl font-display font-bold text-gradient-gold leading-tight">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </>
  );
  if (onClick) {
    return (
      <button
        onClick={onClick}
        className="glass-card rounded-xl p-3 sm:p-4 text-left hover:ring-1 hover:ring-primary/40 transition-all"
      >
        {inner}
      </button>
    );
  }
  return <div className="glass-card rounded-xl p-3 sm:p-4">{inner}</div>;
};

const Section = ({
  title, icon, children, sub,
}: { title: string; icon: React.ReactNode; children: React.ReactNode; sub?: string }) => (
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

const BarRow = ({
  label, count, max, onClick,
}: { label: string; count: number; max: number; onClick?: () => void }) => {
  const content = (
    <>
      <div className="w-24 sm:w-32 text-xs sm:text-sm truncate text-left">{label}</div>
      <div className="flex-1 h-2 bg-muted/40 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-primary/70 to-primary rounded-full"
          style={{ width: `${(count / max) * 100}%` }}
        />
      </div>
      <div className="w-8 text-right text-xs sm:text-sm font-medium tabular-nums">{count}</div>
    </>
  );
  if (onClick) {
    return (
      <button
        onClick={onClick}
        className="w-full flex items-center gap-3 rounded-md px-1 -mx-1 py-1 hover:bg-primary/5 transition-colors"
      >
        {content}
      </button>
    );
  }
  return <div className="flex items-center gap-3 px-1 py-1">{content}</div>;
};

const RecordRow = ({
  label, value, onClick,
}: { label: string; value: string; onClick?: () => void }) => {
  const content = (
    <>
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-medium text-right truncate">{value}</span>
    </>
  );
  if (onClick) {
    return (
      <li>
        <button
          onClick={onClick}
          className="w-full flex justify-between gap-3 rounded-md px-1 -mx-1 py-1 hover:bg-primary/5 transition-colors text-left"
        >
          {content}
        </button>
      </li>
    );
  }
  return <li className="flex justify-between gap-3 px-1 py-1">{content}</li>;
};

const Empty = ({ hint }: { hint?: string } = {}) => (
  <p className="text-sm text-muted-foreground">No data yet{hint ? ` — ${hint}` : ''}.</p>
);

export default Stats;
