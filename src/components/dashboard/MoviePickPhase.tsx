import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Season, MoviePick, GroupMember, Profile } from "@/hooks/useGroup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Check, Film, Star, ExternalLink, X } from "lucide-react";
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

  const userPick = moviePicks.find((p) => p.user_id === user?.id);
  const pickedCount = moviePicks.length;
  const totalMembers = members.length;
  const userConstraint = user ? constraints[user.id] : null;

  // Fetch participant constraints
  useEffect(() => {
    const fetchConstraints = async () => {
      const { data } = await supabase
        .from("season_participants")
        .select("user_id, pick_constraint")
        .eq("season_id", season.id);
      if (data) {
        const map: Record<string, string> = {};
        data.forEach((r) => {
          if (r.pick_constraint) map[r.user_id] = r.pick_constraint;
        });
        setConstraints(map);
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
      // Fetch directors in background
      fetchDirectorsForMovies(newResults);
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

  const pickMovie = async (movie: TMDBMovie) => {
    if (!user) return;
    setSubmitting(true);
    try {
      if (userPick) {
        // Update existing pick
        const { error } = await supabase
          .from("movie_picks")
          .update({
            tmdb_id: movie.id,
            title: movie.title,
            poster_url: movie.poster_path ? `${TMDB_IMAGE_BASE}${movie.poster_path}` : null,
            year: movie.release_date?.split("-")[0] || null,
            overview: movie.overview || null,
          })
          .eq("id", userPick.id);
        if (error) throw error;
        toast.success(`Pick changed to "${movie.title}"!`);
      } else {
        const { error } = await supabase.from("movie_picks").insert({
          season_id: season.id,
          user_id: user.id,
          tmdb_id: movie.id,
          title: movie.title,
          poster_url: movie.poster_path ? `${TMDB_IMAGE_BASE}${movie.poster_path}` : null,
          year: movie.release_date?.split("-")[0] || null,
          overview: movie.overview || null,
        });
        if (error) throw error;
        toast.success(`"${movie.title}" picked!`);
      }
      setResults([]);
      setQuery("");
      setSelected(null);
      setEditing(false);
      onUpdate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save movie pick");
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
      {/* Cinematic picking hero */}
      <div className="relative overflow-hidden rounded-2xl ring-1 ring-white/5 bg-gradient-to-br from-card via-card to-muted/20 px-4 sm:px-6 py-5 sm:py-7 mb-4">
        {/* Soft gold radial glow */}
        <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_80%_10%,hsl(38_90%_55%/0.14),transparent_55%)]" />

        {/* Top row: picking pill */}
        <div className="relative z-10 flex items-center justify-between gap-2 mb-4">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-black/40 backdrop-blur-sm border border-primary/30 px-2.5 py-1">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping-slow absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
            </span>
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Picking Movies</span>
          </span>
        </div>

        {/* Season theme headline */}
        <div className="relative z-10">
          {season.title ? (
            <>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary/70 mb-1">Season Theme</p>
              <h2 className="font-display text-3xl sm:text-4xl font-bold leading-[1.02] text-gradient-gold">{season.title}</h2>
            </>
          ) : (
            <h2 className="font-display text-3xl sm:text-4xl font-bold leading-[1.02] text-gradient-gold">Pick your movie</h2>
          )}
          <p className="text-sm text-muted-foreground mt-2">Everyone secretly picks a movie — reveals come later.</p>
        </div>
      </div>

      {/* Progress card */}
      <div className="rounded-2xl bg-muted/15 border border-border/30 p-4 mb-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <p className="text-sm font-semibold">
            <span className="text-primary tabular-nums">{pickedCount}</span>
            <span className="text-muted-foreground"> of {totalMembers} picked</span>
          </p>
        </div>

        {/* Avatar chips */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {members.map((member) => {
            const profile = profiles.find((p) => p.user_id === member.user_id);
            const hasPicked = moviePicks.some((p) => p.user_id === member.user_id);
            const memberConstraint = constraints[member.user_id];
            const isOwnConstraint = user?.id === member.user_id;
            const showConstraint = memberConstraint && (isOwnConstraint || (season as any).constraints_visible !== false);
            return (
              <div
                key={member.id}
                className={`inline-flex items-center gap-1.5 rounded-full pl-1 pr-2.5 py-1 text-xs border transition-all ${
                  hasPicked
                    ? "bg-primary/10 border-primary/25 text-primary"
                    : "bg-muted/20 border-dashed border-border/60 text-muted-foreground opacity-60"
                }`}
                title={memberConstraint ? `Constraint: ${memberConstraint}` : undefined}
              >
                <span
                  className={`relative flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${
                    hasPicked ? "bg-primary/20 text-primary" : "bg-muted/40 text-muted-foreground"
                  }`}
                >
                  {(profile?.display_name || "?").charAt(0).toUpperCase()}
                  {hasPicked && (
                    <span className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center w-3 h-3 rounded-full bg-primary text-primary-foreground">
                      <Check className="w-2 h-2" strokeWidth={3} />
                    </span>
                  )}
                </span>
                <span className="font-medium">{profile?.display_name || "Unknown"}</span>
                {showConstraint && <span className="text-[10px] opacity-70">({memberConstraint})</span>}
              </div>
            );
          })}
        </div>

        {/* Segmented progress bar */}
        {totalMembers > 0 && (
          <div className="flex gap-1">
            {members.map((member, i) => {
              const filled = i < pickedCount;
              return (
                <div
                  key={member.id}
                  className={`h-2 flex-1 rounded-full transition-all duration-500 ${
                    filled ? "bg-gradient-to-r from-primary to-amber-300" : "bg-muted/40"
                  }`}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* User's constraint callout */}
      {userConstraint && !userPick && (
        <div className="mb-4 p-3 rounded-xl bg-accent/10 border border-accent/20 text-center">
          <p className="text-[10px] uppercase tracking-wider text-accent-foreground/60 mb-0.5">Your Constraint</p>
          <p className="text-sm font-semibold text-accent-foreground">{userConstraint}</p>
        </div>
      )}

      {userPick && !editing ? (
        <div className="space-y-3">
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-5 px-4 sm:px-5 py-4 sm:py-5">
              <div className="flex flex-row sm:flex-col items-start gap-3 sm:gap-0 w-full sm:w-auto">
                {userPick.poster_url ? (
                  <img
                    src={userPick.poster_url}
                    alt={userPick.title}
                    className="w-28 sm:w-44 rounded-xl shadow-xl ring-1 ring-border/20 shrink-0"
                  />
                ) : (
                  <div className="w-28 sm:w-44 aspect-[2/3] rounded-xl bg-muted/30 flex items-center justify-center shrink-0">
                    <Film className="w-8 h-8 sm:w-10 sm:h-10 text-muted-foreground/30" />
                  </div>
                )}
                <div className="sm:hidden flex-1 min-w-0">
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 border border-primary/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary mb-1.5">
                    <Check className="w-2.5 h-2.5" strokeWidth={3} /> Your Pick
                  </span>
                  <h3 className="font-display text-lg font-bold">{userPick.title}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {userPick.year}
                    {userPick.year && pickedDirector && " · "}
                    {pickedDirector && `dir. ${pickedDirector}`}
                  </p>
                  {season.guessing_enabled && (
                    <span className="inline-flex items-center gap-1 mt-2 rounded-full bg-violet-500/15 border border-violet-500/25 px-2 py-0.5 text-[10px] font-medium text-violet-300">
                      Secret until reveal
                    </span>
                  )}
                </div>
              </div>
              <div className="sm:hidden text-xs text-muted-foreground">
                {userPick.overview || "No description available."}
              </div>
              <div className="flex-1 hidden sm:block text-left">
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 border border-primary/25 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary mb-2">
                  <Check className="w-3 h-3" strokeWidth={3} /> Your Pick
                </span>
                <h3 className="font-display text-2xl font-bold">{userPick.title}</h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {userPick.year}
                  {userPick.year && pickedDirector && " · "}
                  {pickedDirector && `dir. ${pickedDirector}`}
                </p>
                <p className="text-sm text-muted-foreground mt-2">{userPick.overview || "No description available."}</p>
                {season.guessing_enabled && (
                  <span className="inline-flex items-center gap-1 mt-3 rounded-full bg-violet-500/15 border border-violet-500/25 px-2.5 py-1 text-[11px] font-medium text-violet-300">
                    Secret until reveal
                  </span>
                )}
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-primary" onClick={() => setEditing(true)}>
            Change pick
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <h3 className="font-display text-lg font-bold">Pick your movie</h3>
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for a movie..."
              className="bg-muted/50 border-border rounded-xl flex-1"
              onKeyDown={(e) => e.key === "Enter" && searchMovies(undefined, 1)}
            />
            <Input
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="Year"
              className="bg-muted/50 border-border rounded-xl w-20"
            />
            <Button variant="gold" onClick={() => searchMovies(undefined, 1)} disabled={searching}>
              <Search className="w-4 h-4" />
            </Button>
          </div>

          {/* Expanded detail view */}
          {selected && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="flex flex-col sm:flex-row">
                {selected.poster_path ? (
                  <img
                    src={`${TMDB_IMAGE_LG}${selected.poster_path}`}
                    alt={selected.title}
                    className="w-full sm:w-48 aspect-[2/3] object-cover"
                  />
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
                    <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {selected.vote_average > 0 && (
                    <div className="flex items-center gap-1.5 mt-2">
                      <Star className="w-4 h-4 text-primary fill-primary" />
                      <span className="text-sm font-semibold">{selected.vote_average.toFixed(1)}</span>
                      <span className="text-xs text-muted-foreground">/ 10</span>
                      <span className="text-xs text-muted-foreground ml-1">
                        ({selected.vote_count.toLocaleString()} votes)
                      </span>
                    </div>
                  )}

                  {selected.overview && (
                    <p className="text-sm text-muted-foreground mt-3 line-clamp-4">{selected.overview}</p>
                  )}

                  <div className="flex items-center gap-2 mt-auto pt-4">
                    <Button variant="gold" onClick={() => pickMovie(selected)} disabled={submitting} className="flex-1">
                      Pick This Movie
                    </Button>
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

          {/* Grid results */}
          {results.length > 0 && !selected && (
            <div className="space-y-1 max-h-[400px] overflow-y-auto rounded-xl border border-border bg-card/50 p-1">
              {results.map((movie, idx) => (
                <button
                  key={`${movie.id}-${idx}`}
                  onClick={() => setSelected(movie)}
                  className="w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-primary/10 transition-colors"
                >
                  {movie.poster_path ? (
                    <img
                      src={`${TMDB_IMAGE_BASE}${movie.poster_path}`}
                      alt={movie.title}
                      className="w-8 h-12 rounded object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-8 h-12 rounded bg-muted flex items-center justify-center shrink-0">
                      <Film className="w-3 h-3 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{movie.title}</p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs text-muted-foreground">{movie.release_date?.split("-")[0]}</span>
                      {directorsMap[movie.id] && (
                        <span className="text-xs text-muted-foreground">· {directorsMap[movie.id]}</span>
                      )}
                      {movie.vote_average > 0 && (
                        <div className="flex items-center gap-0.5">
                          <Star className="w-2.5 h-2.5 text-primary fill-primary" />
                          <span className="text-[11px] text-muted-foreground">{movie.vote_average.toFixed(1)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              ))}
              {hasMoreResults && (
                <button
                  onClick={loadMoreResults}
                  disabled={searching}
                  className="w-full text-center text-sm text-primary hover:text-primary/80 py-2 font-medium"
                >
                  {searching ? "Loading..." : "Load more results"}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Waiting on members */}
      {waitingMembers.length > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          <span className="text-muted-foreground/70">Waiting on {waitingMembers.length} {waitingMembers.length === 1 ? "member" : "members"}:</span>{" "}
          {waitingMembers
            .map((m) => profiles.find((p) => p.user_id === m.user_id)?.display_name || "Unknown")
            .join(", ")}
        </p>
      )}
    </div>
  );
};

export default MoviePickPhase;
