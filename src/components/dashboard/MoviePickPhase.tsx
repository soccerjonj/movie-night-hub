import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Season, MoviePick, GroupMember, Profile } from "@/hooks/useGroup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Check, Film, Star, ExternalLink, X, Lock, EyeOff, Ticket, Link2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { TMDB_API_TOKEN } from "@/lib/apiKeys";

interface Props {
  season: Season;
  moviePicks: MoviePick[];
  members: GroupMember[];
  profiles: Profile[];
  onUpdate: () => void;
}

interface TMDBMovie {
  id: number;
  title: string;
  poster_path: string | null;
  release_date: string;
  overview: string;
  vote_average: number;
  vote_count: number;
  genre_ids: number[];
  popularity: number;
}

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w200";
const TMDB_IMAGE_LG = "https://image.tmdb.org/t/p/w500";

const getLetterboxdUrl = (title: string, year?: string) => {
  const q = encodeURIComponent(year ? `${title} ${year}` : title);
  return `https://letterboxd.com/search/${q}/`;
};

const MoviePickPhase = ({ season, moviePicks, members, profiles, onUpdate }: Props) => {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [results, setResults] = useState<TMDBMovie[]>([]);
  const [searchPage, setSearchPage] = useState(1);
  const [hasMoreResults, setHasMoreResults] = useState(false);
  const [lastSearchTerm, setLastSearchTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<TMDBMovie | null>(null);
  const [director, setDirector] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [directorsMap, setDirectorsMap] = useState<Record<number, string>>({});
  const [pickedDirector, setPickedDirector] = useState<string | null>(null);
  const [constraints, setConstraints] = useState<Record<string, string>>({});
  // co-pick groups configured by the admin in season setup (user_id -> group number)
  const [groupOf, setGroupOf] = useState<Record<string, number>>({});
  // tmdb_ids another member has already picked this season (checked server-side,
  // since other picks are secret during the picking phase)
  const [takenIds, setTakenIds] = useState<Set<number>>(new Set());

  const userPick = moviePicks.find((p) => p.user_id === user?.id);
  // `members` is the season roster; someone the admin sat out isn't in it
  const inSeason = !!user && members.some((m) => m.user_id === user.id);
  const userConstraint = user ? constraints[user.id] : null;
  const myGroup = user ? (groupOf[user.id] ?? null) : null;
  const partners = user && myGroup != null
    ? members.filter((m) => m.user_id !== user.id && groupOf[m.user_id] === myGroup)
    : [];
  // A "unit" is a solo member or one co-pick group; the hero counts units, not rows.
  const unitKey = (userId: string) => (groupOf[userId] != null ? `g${groupOf[userId]}` : userId);
  const totalUnits = new Set(members.map((m) => unitKey(m.user_id))).size;
  const pickedUnits = new Set(moviePicks.filter((p) => p.user_id).map((p) => unitKey(p.user_id as string))).size;

  // Fetch participant constraints
  useEffect(() => {
    const fetchConstraints = async () => {
      const { data } = await supabase
        .from("season_participants")
        .select("user_id, pick_constraint, pick_group")
        .eq("season_id", season.id);
      if (data) {
        const map: Record<string, string> = {};
        const groups: Record<string, number> = {};
        data.forEach((r) => {
          if (r.pick_constraint) map[r.user_id] = r.pick_constraint;
          if (r.pick_group != null) groups[r.user_id] = r.pick_group;
        });
        setConstraints(map);
        setGroupOf(groups);
      }
    };
    fetchConstraints();
  }, [season.id]);

  // Fetch director when a movie is selected
  useEffect(() => {
    if (!selected) {
      setDirector(null);
      return;
    }
    const fetchDirector = async () => {
      try {
        const res = await fetch(`https://api.themoviedb.org/3/movie/${selected.id}/credits?language=en-US`, {
          headers: { Authorization: `Bearer ${TMDB_API_TOKEN}`, Accept: "application/json" },
        });
        const data = await res.json();
        const dir = data.crew?.find((c: { job: string; name: string }) => c.job === "Director");
        setDirector(dir?.name || null);
      } catch {
        setDirector(null);
      }
    };
    fetchDirector();
  }, [selected]);

  // Fetch director for the user's picked movie
  useEffect(() => {
    if (!userPick?.tmdb_id) {
      setPickedDirector(null);
      return;
    }
    const fetchPickedDirector = async () => {
      try {
        const res = await fetch(`https://api.themoviedb.org/3/movie/${userPick.tmdb_id}/credits?language=en-US`, {
          headers: { Authorization: `Bearer ${TMDB_API_TOKEN}`, Accept: "application/json" },
        });
        const data = await res.json();
        const dir = data.crew?.find((c: { job: string; name: string }) => c.job === "Director");
        setPickedDirector(dir?.name || null);
      } catch {
        setPickedDirector(null);
      }
    };
    fetchPickedDirector();
  }, [userPick?.tmdb_id]);

  const fetchDirectorsForMovies = async (movies: TMDBMovie[]) => {
    const idsToFetch = movies.filter((m) => !directorsMap[m.id]).map((m) => m.id);
    if (idsToFetch.length === 0) return;
    const entries = await Promise.all(
      idsToFetch.map(async (id) => {
        try {
          const res = await fetch(`https://api.themoviedb.org/3/movie/${id}/credits?language=en-US`, {
            headers: { Authorization: `Bearer ${TMDB_API_TOKEN}`, Accept: "application/json" },
          });
          const data = await res.json();
          const dir = data.crew?.find((c: { job: string; name: string }) => c.job === "Director");
          return [id, dir?.name || ""] as const;
        } catch {
          return [id, ""] as const;
        }
      }),
    );
    setDirectorsMap((prev) => {
      const updated = { ...prev };
      entries.forEach(([id, name]) => {
        updated[id] = name;
      });
      return updated;
    });
  };

  const checkTaken = async (ids: number[]): Promise<Set<number>> => {
    if (ids.length === 0) return new Set();
    const { data } = await supabase.rpc("check_taken_picks", { _season_id: season.id, _tmdb_ids: ids });
    const found = new Set<number>(data ?? []);
    if (found.size > 0) setTakenIds((prev) => new Set([...prev, ...found]));
    return found;
  };

  const searchMovies = async (q?: string, page = 1) => {
    const term = q ?? query;
    if (!term.trim()) {
      setResults([]);
      setHasMoreResults(false);
      return;
    }
    if (!TMDB_API_TOKEN) {
      toast.error("TMDB API token is missing. Set VITE_TMDB_API_TOKEN and try again.");
      return;
    }
    setSearching(true);
    setSelected(null);
    try {
      const res = await fetch(
        `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(term)}&include_adult=false&language=en-US&page=${page}${yearFilter ? `&year=${yearFilter}` : ""}`,
        {
          headers: {
            Authorization: `Bearer ${TMDB_API_TOKEN}`,
            Accept: "application/json",
          },
        },
      );
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`TMDB search failed (${res.status}). ${errText.slice(0, 200)}`);
      }
      const data = await res.json();
      const newResults = ((data.results || []) as TMDBMovie[]).sort((a, b) => {
        // Weight by vote_count (well-known films) and popularity
        const scoreA = (a.vote_count || 0) * 0.5 + (a.popularity || 0);
        const scoreB = (b.vote_count || 0) * 0.5 + (b.popularity || 0);
        return scoreB - scoreA;
      });
      if (page === 1) {
        setResults(newResults);
      } else {
        setResults((prev) => [...prev, ...newResults]);
      }
      setSearchPage(page);
      setLastSearchTerm(term);
      setHasMoreResults(page < (data.total_pages || 1));
      // Fetch directors + taken status in background
      fetchDirectorsForMovies(newResults);
      checkTaken(newResults.map((m) => m.id));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to search movies");
    } finally {
      setSearching(false);
    }
  };

  const loadMoreResults = () => {
    if (hasMoreResults && !searching) {
      searchMovies(lastSearchTerm, searchPage + 1);
    }
  };

  // Auto-search as user types (debounced)
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setHasMoreResults(false);
      return;
    }
    const timer = setTimeout(() => searchMovies(query, 1), 350);
    return () => clearTimeout(timer);
  }, [query, yearFilter]);

  const TAKEN_MSG = "Someone in the club already picked that film — choose another.";

  const pickMovie = async (movie: TMDBMovie) => {
    if (!user) return;
    setSubmitting(true);
    try {
      // Re-check right before saving; submit_pick + the unique index are the backstops.
      const taken = await checkTaken([movie.id]);
      if (taken.has(movie.id)) {
        toast.error(TAKEN_MSG);
        return;
      }
      // Writes a row for every member of the caller's co-pick group (or just the caller).
      const { error } = await supabase.rpc("submit_pick", {
        _season_id: season.id,
        _tmdb_id: movie.id,
        _title: movie.title,
        _poster_url: movie.poster_path ? `${TMDB_IMAGE_BASE}${movie.poster_path}` : null,
        _year: movie.release_date?.split("-")[0] || null,
        _overview: movie.overview || null,
      });
      if (error) throw error;
      toast.success(userPick ? `Pick changed to "${movie.title}"!` : `"${movie.title}" picked!`);
      setResults([]);
      setQuery("");
      setSelected(null);
      setEditing(false);
      onUpdate();
    } catch (err: unknown) {
      // 23505 = another unit already has this film (index or submit_pick check)
      if (typeof err === "object" && err && (err as { code?: string }).code === "23505") {
        setTakenIds((prev) => new Set([...prev, movie.id]));
        toast.error(TAKEN_MSG);
      } else {
        const msg = (err as { message?: string })?.message;
        toast.error(msg ? `Couldn't save pick: ${msg}` : "Failed to save movie pick");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const removePick = async () => {
    if (!userPick || !user) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from("movie_picks").delete().eq("id", userPick.id);
      if (error) throw error;
      toast.success("Pick removed");
      setEditing(false);
      onUpdate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to remove pick");
    } finally {
      setSubmitting(false);
    }
  };

  const waitingMembers = members.filter((m) => !moviePicks.some((p) => p.user_id === m.user_id));

  return (
    <div className="glass-card rounded-2xl p-4 sm:p-6 mt-4 sm:mt-6">
      {/* Hero: spotlight, theme headline, big sealed count */}
      <div className="relative overflow-hidden rounded-2xl ring-1 ring-white/5 bg-gradient-to-b from-card to-card/60 px-4 sm:px-6 py-5 sm:py-6">
        <div className="absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_-10%,hsl(38_90%_55%/0.22),transparent_60%)]" />
        <div className="relative z-10">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/40 backdrop-blur-sm border border-primary/30 px-2.5 py-1">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping-slow absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
              </span>
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Picking Movies</span>
            </span>
            <span className="text-[11px] text-muted-foreground">Season {season.season_number}</span>
          </div>

          {season.title ? (
            <>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary/70 mt-4 mb-1">Season Theme</p>
              <h2 className="font-display text-3xl sm:text-4xl font-bold leading-[1.02] text-gradient-gold">{season.title}</h2>
            </>
          ) : (
            <h2 className="font-display text-3xl sm:text-4xl font-bold leading-[1.02] text-gradient-gold mt-4">Pick your movie</h2>
          )}

          <div className="flex items-end gap-3 mt-4">
            <div className="font-display text-4xl sm:text-5xl font-bold leading-none text-gradient-gold tabular-nums">
              {pickedUnits}
              <span className="text-lg sm:text-xl font-semibold text-muted-foreground">/{totalUnits}</span>
            </div>
            <div className="text-xs sm:text-sm leading-tight pb-0.5">
              <p className="text-foreground/80">picks sealed</p>
              <p className="text-muted-foreground">
                {waitingMembers.length === 0
                  ? "Everyone is in"
                  : `${waitingMembers.length} ${waitingMembers.length === 1 ? "member" : "members"} still choosing`}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* The lineup: one sealed card per member */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between px-0.5 mb-2">
          <p className="text-sm font-semibold">The lineup</p>
          <p className="text-[11px] text-muted-foreground">Revealed on watch day</p>
        </div>
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
          {members.map((member) => {
            const profile = profiles.find((p) => p.user_id === member.user_id);
            const pick = moviePicks.find((p) => p.user_id === member.user_id);
            const isMe = user?.id === member.user_id;
            const memberGroup = groupOf[member.user_id] ?? null;
            const inMyGroup = !isMe && myGroup != null && memberGroup === myGroup;
            const name = profile?.display_name || "Unknown";
            const initial = name.charAt(0).toUpperCase();
            const memberConstraint = constraints[member.user_id];
            const showConstraint = memberConstraint && (isMe || (season as any).constraints_visible !== false);
            const avatar = (muted: boolean) => (
              <span
                className={`w-7 h-7 rounded-full overflow-hidden flex items-center justify-center text-xs font-bold ${
                  muted ? "bg-muted/40 text-muted-foreground" : "bg-primary/15 text-primary"
                }`}
              >
                {profile?.avatar_url ? <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" /> : initial}
              </span>
            );
            return (
              <div key={member.id} className="text-center min-w-0" title={showConstraint ? `Constraint: ${memberConstraint}` : undefined}>
                {pick && (isMe || inMyGroup) ? (
                  <div className={`relative aspect-[2/3] rounded-lg overflow-hidden ring-2 ring-primary ${isMe ? "shadow-[0_0_18px_-4px_hsl(38_90%_55%/0.6)]" : "ring-primary/60"}`}>
                    {pick.poster_url ? (
                      <img src={pick.poster_url} alt={pick.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-muted/40 flex items-center justify-center">
                        <Film className="w-5 h-5 text-muted-foreground/40" />
                      </div>
                    )}
                    <span className="absolute top-1 left-1 rounded bg-primary text-primary-foreground text-[8px] font-bold tracking-[0.12em] px-1.5 py-0.5">
                      {isMe ? "YOU" : "WITH YOU"}
                    </span>
                  </div>
                ) : pick ? (
                  <div className="relative aspect-[2/3] rounded-lg bg-gradient-to-b from-muted/30 to-card ring-1 ring-primary/40 flex flex-col items-center justify-center gap-1.5">
                    {memberGroup != null && <Link2 className="absolute top-1 right-1 w-3 h-3 text-primary/60" aria-label="Shared pick" />}
                    {avatar(false)}
                    <Lock className="w-3 h-3 text-primary/70" />
                  </div>
                ) : (
                  <div className="relative aspect-[2/3] rounded-lg border-2 border-dashed border-border/50 flex flex-col items-center justify-center gap-1.5">
                    {memberGroup != null && <Link2 className="absolute top-1 right-1 w-3 h-3 text-muted-foreground/50" aria-label="Shared pick" />}
                    {avatar(true)}
                    <span className="text-[9px] text-muted-foreground">waiting</span>
                  </div>
                )}
                <p className={`text-[10px] mt-1 truncate ${pick ? "text-foreground" : "text-muted-foreground"}`}>{name}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Constraint ticket — shown while the user still needs to choose */}
      {userConstraint && (!userPick || editing) && (
        <div className="mt-4 flex items-center gap-3 rounded-xl bg-primary/10 border border-primary/25 px-3 py-2.5">
          <Ticket className="w-4 h-4 text-primary shrink-0" />
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-primary/70">Your constraint</p>
            <p className="text-sm font-medium truncate">{userConstraint}</p>
          </div>
        </div>
      )}

      {!inSeason ? (
        <div className="mt-4 rounded-2xl bg-muted/15 border border-border/30 px-4 py-5 text-center">
          <p className="text-sm font-semibold">You're sitting this season out</p>
          <p className="text-xs text-muted-foreground mt-1">The admin removed you from this season's roster. You'll still see how it goes — and you're in for the next one.</p>
        </div>
      ) : userPick && !editing ? (
        /* Your pick: poster on its own blurred backdrop */
        <div className="mt-4 relative rounded-2xl overflow-hidden ring-1 ring-white/5">
          {userPick.poster_url && (
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: `url(${userPick.poster_url})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                filter: "blur(28px) saturate(1.3)",
                transform: "scale(1.3)",
                opacity: 0.35,
              }}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-card via-card/85 to-card/60" />
          <div className="relative z-10 flex gap-4 p-4">
            {userPick.poster_url ? (
              <img src={userPick.poster_url} alt={userPick.title} className="w-20 sm:w-28 rounded-lg shadow-xl ring-1 ring-white/10 shrink-0 self-start" />
            ) : (
              <div className="w-20 sm:w-28 aspect-[2/3] rounded-lg bg-muted/30 flex items-center justify-center shrink-0">
                <Film className="w-8 h-8 text-muted-foreground/30" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 border border-primary/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                <Check className="w-2.5 h-2.5" strokeWidth={3} /> Your Pick
              </span>
              <h3 className="font-display text-xl sm:text-2xl font-bold leading-tight mt-1.5">{userPick.title}</h3>
              <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                {userPick.year}
                {userPick.year && pickedDirector && " · "}
                {pickedDirector && `dir. ${pickedDirector}`}
              </p>
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                {season.guessing_enabled && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 border border-violet-500/25 px-2 py-0.5 text-[10px] font-medium text-violet-300">
                    <EyeOff className="w-3 h-3" /> Secret until reveal
                  </span>
                )}
                {partners.length > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/25 px-2 py-0.5 text-[10px] font-medium text-primary">
                    <Link2 className="w-3 h-3" /> Shared with {partners.map((m) => profiles.find((p) => p.user_id === m.user_id)?.display_name || "Unknown").join(" & ")}
                  </span>
                )}
              </div>
              {userPick.overview && <p className="hidden sm:block text-sm text-muted-foreground mt-2 line-clamp-3">{userPick.overview}</p>}
            </div>
          </div>
          <button
            onClick={() => setEditing(true)}
            className="relative z-10 w-full text-left border-t border-white/5 px-4 py-2.5 text-xs text-muted-foreground hover:text-primary hover:bg-white/[0.03] transition-colors"
          >
            Change pick
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search for a movie"
                className="bg-muted/40 border-border/60 rounded-xl pl-9 h-11"
                onKeyDown={(e) => e.key === "Enter" && searchMovies(undefined, 1)}
              />
            </div>
            <Input
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="Year"
              className="bg-muted/40 border-border/60 rounded-xl w-20 h-11"
            />
            <Button variant="gold" className="h-11 rounded-xl" onClick={() => searchMovies(undefined, 1)} disabled={searching}>
              <Search className="w-4 h-4" />
            </Button>
          </div>
          {partners.length > 0 && (
            <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5 text-primary" />
              Shared pick — whatever you choose counts for you and {partners.map((m) => profiles.find((p) => p.user_id === m.user_id)?.display_name || "Unknown").join(" & ")}.
            </p>
          )}
          {editing && userPick && (
            <button onClick={() => setEditing(false)} className="text-xs text-muted-foreground hover:text-primary transition-colors">
              Keep “{userPick.title}”
            </button>
          )}

          {/* Expanded detail view */}
          {selected && (
            <div className="relative rounded-2xl overflow-hidden ring-1 ring-white/5 bg-card">
              <div className="flex flex-col sm:flex-row">
                {selected.poster_path ? (
                  <img src={`${TMDB_IMAGE_LG}${selected.poster_path}`} alt={selected.title} className="w-full sm:w-48 aspect-[2/3] object-cover" />
                ) : (
                  <div className="w-full sm:w-48 aspect-[2/3] bg-muted flex items-center justify-center">
                    <Film className="w-12 h-12 text-muted-foreground" />
                  </div>
                )}
                <div className="p-4 flex-1 flex flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-display text-lg font-bold">{selected.title}</h3>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm text-muted-foreground">{selected.release_date?.split("-")[0]}</p>
                        {director && (
                          <>
                            <span className="text-sm text-muted-foreground">·</span>
                            <p className="text-sm text-muted-foreground">Dir. {director}</p>
                          </>
                        )}
                      </div>
                    </div>
                    <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground" aria-label="Close">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {selected.vote_average > 0 && (
                    <div className="flex items-center gap-1.5 mt-2">
                      <Star className="w-4 h-4 text-primary fill-primary" />
                      <span className="text-sm font-semibold">{selected.vote_average.toFixed(1)}</span>
                      <span className="text-xs text-muted-foreground">/ 10</span>
                      <span className="text-xs text-muted-foreground ml-1">({selected.vote_count.toLocaleString()} votes)</span>
                    </div>
                  )}

                  {selected.overview && <p className="text-sm text-muted-foreground mt-3 line-clamp-4">{selected.overview}</p>}

                  <div className="flex items-center gap-2 mt-auto pt-4">
                    {takenIds.has(selected.id) ? (
                      <div className="flex-1 min-w-0 inline-flex items-center gap-1.5 rounded-xl bg-muted/30 border border-border/50 px-3 py-2 text-sm text-muted-foreground">
                        <Lock className="w-3.5 h-3.5 shrink-0" /> Already picked by someone in the club
                      </div>
                    ) : (
                      <Button variant="gold" onClick={() => pickMovie(selected)} disabled={submitting} className="flex-1 min-w-0 rounded-xl">
                        <span className="truncate">Pick “{selected.title}”</span>
                      </Button>
                    )}
                    <a
                      href={getLetterboxdUrl(selected.title, selected.release_date?.split("-")[0])}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors px-3 py-2 rounded-lg border border-border hover:border-primary/30"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Letterboxd
                    </a>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Poster grid results */}
          {results.length > 0 && !selected && (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 max-h-[460px] overflow-y-auto pr-0.5">
              {results.map((movie, idx) => {
                const year = movie.release_date?.split("-")[0];
                const taken = takenIds.has(movie.id);
                return (
                  <button
                    key={`${movie.id}-${idx}`}
                    onClick={() => setSelected(movie)}
                    className={`group relative aspect-[2/3] rounded-lg overflow-hidden bg-muted/30 ring-1 ring-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary transition text-left ${
                      taken ? "opacity-50 saturate-50" : "hover:ring-primary/60"
                    }`}
                  >
                    {taken && (
                      <span className="absolute top-1 left-1 z-10 inline-flex items-center gap-1 rounded bg-black/70 backdrop-blur-sm text-[9px] font-bold uppercase tracking-wider text-white/80 px-1.5 py-0.5">
                        <Lock className="w-2.5 h-2.5" /> Taken
                      </span>
                    )}
                    {movie.poster_path ? (
                      <img
                        src={`${TMDB_IMAGE_BASE}${movie.poster_path}`}
                        alt={movie.title}
                        className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Film className="w-6 h-6 text-muted-foreground/40" />
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-1.5 pt-6 pb-1.5">
                      <p className="text-[11px] font-semibold leading-tight line-clamp-2 text-white">{movie.title}</p>
                      <p className="text-[10px] text-white/60 mt-0.5 flex items-center gap-1 truncate">
                        {year}
                        {movie.vote_average > 0 && (
                          <>
                            <span>·</span>
                            <Star className="w-2.5 h-2.5 text-primary fill-primary shrink-0" />
                            {movie.vote_average.toFixed(1)}
                          </>
                        )}
                        {directorsMap[movie.id] && <span className="truncate">· {directorsMap[movie.id]}</span>}
                      </p>
                    </div>
                  </button>
                );
              })}
              {hasMoreResults && (
                <button
                  onClick={loadMoreResults}
                  disabled={searching}
                  className="col-span-full text-center text-sm text-primary hover:text-primary/80 py-2 font-medium"
                >
                  {searching ? "Loading..." : "Load more results"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MoviePickPhase;
