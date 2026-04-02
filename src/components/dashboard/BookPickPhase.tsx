import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Season, MoviePick, GroupMember, Profile } from '@/hooks/useGroup';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Check, BookOpen, Star, ExternalLink, X } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { GOOGLE_BOOKS_API_KEY } from '@/lib/apiKeys';
import { sortBooksByPopularity } from '@/lib/bookSearch';

interface Props {
  season: Season;
  moviePicks: MoviePick[];
  members: GroupMember[];
  profiles: Profile[];
  onUpdate: () => void;
}

interface GoogleBook {
  id: string;
  volumeInfo: {
    title: string;
    authors?: string[];
    publishedDate?: string;
    description?: string;
    imageLinks?: {
      thumbnail?: string;
      smallThumbnail?: string;
    };
    averageRating?: number;
    ratingsCount?: number;
    categories?: string[];
    pageCount?: number;
  };
}

const getGoodreadsUrl = (title: string) => {
  const q = encodeURIComponent(title);
  return `https://www.goodreads.com/search?q=${q}`;
};

const BookPickPhase = ({ season, moviePicks, members, profiles, onUpdate }: Props) => {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GoogleBook[]>([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<GoogleBook | null>(null);
  const [editing, setEditing] = useState(false);
  const [constraints, setConstraints] = useState<Record<string, string>>({});

  const userPick = moviePicks.find(p => p.user_id === user?.id);
  const pickedCount = moviePicks.length;
  const totalMembers = members.length;
  const userConstraint = user ? constraints[user.id] : null;

  // Fetch participant constraints
  useEffect(() => {
    const fetchConstraints = async () => {
      const { data } = await supabase
        .from('season_participants')
        .select('user_id, pick_constraint')
        .eq('season_id', season.id);
      if (data) {
        const map: Record<string, string> = {};
        data.forEach(r => { if (r.pick_constraint) map[r.user_id] = r.pick_constraint; });
        setConstraints(map);
      }
    };
    fetchConstraints();
  }, [season.id]);

  const searchBooks = async (q?: string) => {
    const term = q ?? query;
    if (!term.trim()) { setResults([]); return; }
    setSearching(true);
    setSelected(null);
    try {
      const keyParam = GOOGLE_BOOKS_API_KEY ? `&key=${encodeURIComponent(GOOGLE_BOOKS_API_KEY)}` : '';
      const res = await fetch(
        `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(term)}&maxResults=20&printType=books&orderBy=relevance${keyParam}`
      );
      if (!res.ok) {
        let details = '';
        try {
          const errJson = await res.json();
          details = errJson?.error?.message || JSON.stringify(errJson);
        } catch {
          try { details = await res.text(); } catch { details = ''; }
        }
        throw new Error(`Books API error (${res.status})${details ? `: ${details}` : ''}`);
      }
      const data = await res.json();
      const items = (data.items || []) as GoogleBook[];
      setResults(sortBooksByPopularity(items, term));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to search books');
    } finally {
      setSearching(false);
    }
  };

  // Auto-search as user types (debounced)
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const timer = setTimeout(() => searchBooks(query), 350);
    return () => clearTimeout(timer);
  }, [query]);

  const pickBook = async (book: GoogleBook) => {
    if (!user) return;
    setSubmitting(true);
    try {
      const info = book.volumeInfo;
      const coverUrl = info.imageLinks?.thumbnail?.replace('http:', 'https:') || null;
      const year = info.publishedDate?.split('-')[0] || null;
      const title = info.title;
      const overview = info.description?.substring(0, 500) || null;

      if (userPick) {
        const { error } = await supabase.from('movie_picks').update({
          tmdb_id: null,
          title,
          poster_url: coverUrl,
          year,
          overview,
        }).eq('id', userPick.id);
        if (error) throw error;
        toast.success(`Pick changed to "${title}"!`);
      } else {
        const { error } = await supabase.from('movie_picks').insert({
          season_id: season.id,
          user_id: user.id,
          tmdb_id: null,
          title,
          poster_url: coverUrl,
          year,
          overview,
        });
        if (error) throw error;
        toast.success(`"${title}" picked!`);
      }
      setResults([]);
      setQuery('');
      setSelected(null);
      setEditing(false);
      onUpdate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save book pick');
    } finally {
      setSubmitting(false);
    }
  };

  const removePick = async () => {
    if (!userPick || !user) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from('movie_picks').delete().eq('id', userPick.id);
      if (error) throw error;
      toast.success('Pick removed');
      setEditing(false);
      onUpdate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove pick');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="glass-card rounded-2xl p-4 sm:p-6 mt-4 sm:mt-6">
      {season.title && (
        <div className="mb-4 p-3 rounded-xl bg-primary/5 border border-primary/10 text-center">
          <p className="text-xs uppercase tracking-wider text-primary/70 mb-0.5">Book Theme</p>
          <h3 className="font-display text-lg sm:text-xl font-bold text-primary">{season.title}</h3>
        </div>
      )}
      <h2 className="font-display text-lg sm:text-xl font-bold mb-1">Pick Your Book</h2>
      <p className="text-sm text-muted-foreground mb-3">
        {pickedCount} of {totalMembers} members have picked
      </p>

      {/* User's constraint callout */}
      {userConstraint && !userPick && (
        <div className="mb-3 p-2.5 rounded-lg bg-accent/10 border border-accent/20 text-center">
          <p className="text-xs uppercase tracking-wider text-accent-foreground/60 mb-0.5">Your Constraint</p>
          <p className="text-sm font-semibold text-accent-foreground">{userConstraint}</p>
        </div>
      )}

      {/* Member pick status */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {members.map((member) => {
          const profile = profiles.find(p => p.user_id === member.user_id);
          const hasPicked = moviePicks.some(p => p.user_id === member.user_id);
          const memberConstraint = constraints[member.user_id];
          const isOwnConstraint = user?.id === member.user_id;
          const showConstraint = memberConstraint && (isOwnConstraint || (season as any).constraints_visible !== false);
          return (
            <div
              key={member.id}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
                hasPicked ? 'bg-primary/10 text-primary' : 'bg-muted/20 text-muted-foreground'
              }`}
              title={memberConstraint ? `Constraint: ${memberConstraint}` : undefined}
            >
              {hasPicked ? <Check className="w-3 h-3" /> : <span className="w-3 h-3 rounded-full border border-current opacity-40" />}
              {profile?.display_name || 'Unknown'}
              {showConstraint && <span className="text-[10px] opacity-70">({memberConstraint})</span>}
            </div>
          );
        })}
      </div>

      {userPick && !editing ? (
        <div className="flex items-center gap-3 bg-primary/5 rounded-xl p-4">
          <Check className="w-5 h-5 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium">You picked: {userPick.title}</p>
            <p className="text-xs text-muted-foreground">Your pick is secret until revealed!</p>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              Change
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={submitting}>
                  Remove
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove your pick?</AlertDialogTitle>
                  <AlertDialogDescription>This will remove "{userPick.title}" as your pick. You can search and pick a new book after.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={removePick} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for a book..."
              className="bg-muted/50 border-border flex-1"
              onKeyDown={(e) => e.key === 'Enter' && searchBooks()}
            />
            <Button variant="gold" onClick={() => searchBooks()} disabled={searching}>
              <Search className="w-4 h-4" />
            </Button>
          </div>

          {/* Expanded detail view */}
          {selected && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="flex flex-col sm:flex-row">
                {selected.volumeInfo.imageLinks?.thumbnail ? (
                  <img
                    src={selected.volumeInfo.imageLinks.thumbnail.replace('http:', 'https:')}
                    alt={selected.volumeInfo.title}
                    className="w-full sm:w-48 aspect-[2/3] object-cover"
                  />
                ) : (
                  <div className="w-full sm:w-48 aspect-[2/3] bg-muted flex items-center justify-center">
                    <BookOpen className="w-12 h-12 text-muted-foreground" />
                  </div>
                )}
                <div className="p-4 flex-1 flex flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-display text-lg font-bold">{selected.volumeInfo.title}</h3>
                      <div className="flex items-center gap-2 flex-wrap">
                        {selected.volumeInfo.authors && (
                          <p className="text-sm text-muted-foreground">{selected.volumeInfo.authors.join(', ')}</p>
                        )}
                        {selected.volumeInfo.publishedDate && (
                          <>
                            <span className="text-sm text-muted-foreground">·</span>
                            <p className="text-sm text-muted-foreground">{selected.volumeInfo.publishedDate.split('-')[0]}</p>
                          </>
                        )}
                      </div>
                    </div>
                    <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {selected.volumeInfo.averageRating && (
                    <div className="flex items-center gap-1.5 mt-2">
                      <Star className="w-4 h-4 text-primary fill-primary" />
                      <span className="text-sm font-semibold">{selected.volumeInfo.averageRating.toFixed(1)}</span>
                      <span className="text-xs text-muted-foreground">/ 5</span>
                      {selected.volumeInfo.ratingsCount && (
                        <span className="text-xs text-muted-foreground ml-1">({selected.volumeInfo.ratingsCount.toLocaleString()} ratings)</span>
                      )}
                    </div>
                  )}

                  {selected.volumeInfo.description && (
                    <p className="text-sm text-muted-foreground mt-3 line-clamp-4"
                       dangerouslySetInnerHTML={{ __html: selected.volumeInfo.description.substring(0, 500) }} />
                  )}

                  <div className="flex items-center gap-2 mt-auto pt-4">
                    <Button variant="gold" onClick={() => pickBook(selected)} disabled={submitting} className="flex-1">
                      Pick This Book
                    </Button>
                    <a
                      href={getGoodreadsUrl(selected.volumeInfo.title)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors px-3 py-2 rounded-lg border border-border hover:border-primary/30"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Goodreads
                    </a>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Grid results */}
          {results.length > 0 && !selected && (
            <div className="space-y-1 max-h-[400px] overflow-y-auto rounded-xl border border-border bg-card/50 p-1">
              {results.map((book) => (
                <button
                  key={book.id}
                  onClick={() => setSelected(book)}
                  className="w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-primary/10 transition-colors"
                >
                  {book.volumeInfo.imageLinks?.smallThumbnail ? (
                    <img
                      src={book.volumeInfo.imageLinks.smallThumbnail.replace('http:', 'https:')}
                      alt={book.volumeInfo.title}
                      className="w-8 h-12 rounded object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-8 h-12 rounded bg-muted flex items-center justify-center shrink-0">
                      <BookOpen className="w-3 h-3 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{book.volumeInfo.title}</p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {book.volumeInfo.authors && (
                        <span className="text-xs text-muted-foreground truncate">{book.volumeInfo.authors[0]}</span>
                      )}
                      {book.volumeInfo.publishedDate && (
                        <span className="text-xs text-muted-foreground">· {book.volumeInfo.publishedDate.split('-')[0]}</span>
                      )}
                      {book.volumeInfo.averageRating && (
                        <div className="flex items-center gap-0.5">
                          <Star className="w-2.5 h-2.5 text-primary fill-primary" />
                          <span className="text-[11px] text-muted-foreground">{book.volumeInfo.averageRating.toFixed(1)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BookPickPhase;
