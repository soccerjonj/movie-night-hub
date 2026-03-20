import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Users, Plus, ArrowRight, Ghost, UserCheck, Film, BookOpen, Video, MapPin, ChevronRight, ChevronLeft, Search, Star, X, Check, BookMarked, Vote, CalendarClock } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import logo from '@/assets/logo.png';
import { toast } from 'sonner';
import { GOOGLE_BOOKS_API_KEY } from '@/lib/apiKeys';
import { motion, AnimatePresence } from 'framer-motion';
import { groupNameSchema, joinCodeSchema, getSafeErrorMessage } from '@/lib/security';

interface PlaceholderProfile {
  user_id: string;
  display_name: string;
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
    pageCount?: number;
  };
}

type Mode = 'choose' | 'create' | 'join' | 'claim';
type CreateStep = 'type' | 'name' | 'meeting' | 'book_choice' | 'book_search' | 'chapters' | 'confirm';

const GroupSetup = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('choose');

  // Create wizard state
  const [createStep, setCreateStep] = useState<CreateStep>('type');
  const [clubType, setClubType] = useState<'movie' | 'book'>('movie');
  const [groupName, setGroupName] = useState('');
  const [meetingType, setMeetingType] = useState<'remote' | 'in_person'>('remote');
  const [meetingLocation, setMeetingLocation] = useState('');

  // Book-specific state
  const [bookChoice, setBookChoice] = useState<'chosen' | 'vote' | null>(null);
  const [bookQuery, setBookQuery] = useState('');
  const [bookResults, setBookResults] = useState<GoogleBook[]>([]);
  const [bookSearching, setBookSearching] = useState(false);
  const [selectedBook, setSelectedBook] = useState<GoogleBook | null>(null);
  const [chapterChoice, setChapterChoice] = useState<'later' | 'now'>('later');

  // Join state
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [foundGroupId, setFoundGroupId] = useState<string | null>(null);
  const [placeholders, setPlaceholders] = useState<PlaceholderProfile[]>([]);
  const [selectedPlaceholder, setSelectedPlaceholder] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
  }, [user, navigate]);

  // Compute dynamic steps based on club type and choices
  const getSteps = (): CreateStep[] => {
    const steps: CreateStep[] = ['type', 'name', 'meeting'];
    if (clubType === 'book') {
      steps.push('book_choice');
      if (bookChoice === 'chosen') {
        steps.push('book_search');
        if (selectedBook) {
          steps.push('chapters');
        }
      }
    }
    steps.push('confirm');
    return steps;
  };

  const steps = getSteps();
  const stepIndex = steps.indexOf(createStep);

  const goNextStep = () => {
    const next = steps[stepIndex + 1];
    if (next) setCreateStep(next);
  };

  const goPrevStep = () => {
    const prev = steps[stepIndex - 1];
    if (prev) setCreateStep(prev);
    else setMode('choose');
  };

  const canProceed = () => {
    switch (createStep) {
      case 'type': return true;
      case 'name': return groupName.trim().length > 0;
      case 'meeting': return true;
      case 'book_choice': return bookChoice !== null;
      case 'book_search': return selectedBook !== null;
      case 'chapters': return true;
      case 'confirm': return true;
      default: return false;
    }
  };

  // Book search
  const searchBooks = async (q?: string) => {
    const term = q ?? bookQuery;
    if (!term.trim()) { setBookResults([]); return; }
    setBookSearching(true);
    try {
      const keyParam = GOOGLE_BOOKS_API_KEY ? `&key=${encodeURIComponent(GOOGLE_BOOKS_API_KEY)}` : '';
      const res = await fetch(
        `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(term)}&maxResults=8&printType=books${keyParam}`
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
      setBookResults((data.items || []) as GoogleBook[]);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to search books');
    } finally {
      setBookSearching(false);
    }
  };

  useEffect(() => {
    if (createStep !== 'book_search' || !bookQuery.trim()) { setBookResults([]); return; }
    const timer = setTimeout(() => searchBooks(bookQuery), 400);
    return () => clearTimeout(timer);
  }, [bookQuery, createStep]);

  const handleCreateGroup = async () => {
    const parsed = groupNameSchema.safeParse({ name: groupName });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    if (!user) return;
    setLoading(true);
    try {
      const { data: group, error: groupError } = await supabase
        .from('groups')
        .insert({
          name: parsed.data.name,
          admin_user_id: user.id,
          club_type: clubType,
          meeting_type: meetingType,
          meeting_location: meetingType === 'in_person' ? meetingLocation.trim() : null,
        } as any)
        .select()
        .single();
      if (groupError) throw groupError;

      const { error: memberError } = await supabase
        .from('group_members')
        .insert({ group_id: group.id, user_id: user.id });
      if (memberError) throw memberError;

      // If book was pre-selected, auto-create season 1 with the book as a pick
      if (clubType === 'book' && bookChoice === 'chosen' && selectedBook) {
        const { data: seasonData, error: seasonError } = await supabase
          .from('seasons')
          .insert({
            group_id: group.id,
            season_number: 1,
            status: 'picking',
            movies_per_member: 1,
            watch_interval_days: 7,
            guessing_enabled: false,
          })
          .select()
          .single();
        if (seasonError) throw seasonError;

        // Add the admin as a season participant
        await supabase.from('season_participants').insert({
          season_id: seasonData.id,
          user_id: user.id,
        });

        // Insert the selected book as a pick
        const info = selectedBook.volumeInfo;
        const coverUrl = info.imageLinks?.thumbnail?.replace('http:', 'https:') || null;
        const year = info.publishedDate?.split('-')[0] || null;
        await supabase.from('movie_picks').insert({
          season_id: seasonData.id,
          user_id: user.id,
          tmdb_id: null,
          title: info.title,
          poster_url: coverUrl,
          year,
          overview: info.description?.substring(0, 500) || null,
        });
      }

      // Flag for walkthrough
      localStorage.setItem(`show_walkthrough_${group.id}`, 'true');

      toast.success('Club created!');
      navigate(`/dashboard/${group.id}`);
    } catch (err: unknown) {
      toast.error(getSafeErrorMessage(err, 'Failed to create group'));
    } finally {
      setLoading(false);
    }
  };

  const handleFindGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = joinCodeSchema.safeParse({ code: joinCode.trim().toLowerCase() });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    if (!user) return;
    setLoading(true);
    try {
      const { data: groups, error: findError } = await supabase
        .rpc('find_group_by_code', { _code: parsed.data.code });

      if (findError || !groups || groups.length === 0) {
        throw new Error('Invalid join code. Please check and try again.');
      }

      const groupId = groups[0].id;
      setFoundGroupId(groupId);

      const { data: claimableNames, error: placeholdersError } = await supabase
        .rpc('list_available_placeholders', { _group_id: groupId });
      if (placeholdersError) throw placeholdersError;

      if (claimableNames && claimableNames.length > 0) {
        const sorted = [...(claimableNames as PlaceholderProfile[])].sort((a, b) =>
          a.display_name.localeCompare(b.display_name),
        );
        setPlaceholders(sorted);
        setMode('claim');
        return;
      }

      throw new Error('No available member names. Ask your admin to add you first.');
    } catch (err: unknown) {
      toast.error(getSafeErrorMessage(err, 'Failed to find group'));
    } finally {
      setLoading(false);
    }
  };

  const joinGroup = async (groupId: string, placeholderUserId: string) => {
    if (!user) return;
    setLoading(true);
    try {
      const { error } = await supabase.rpc('claim_placeholder', {
        _placeholder_user_id: placeholderUserId,
        _real_user_id: user.id,
        _group_id: groupId,
      });
      if (error) throw error;
      toast.success('Joined the group!');
      navigate('/clubs');
    } catch (err: unknown) {
      toast.error(getSafeErrorMessage(err, 'Failed to join group'));
    } finally {
      setLoading(false);
    }
  };

  const itemLabel = clubType === 'movie' ? 'movie' : 'book';

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-primary/5 blur-[120px]" />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="glass-card rounded-2xl p-8 w-full max-w-md mx-4 relative z-10"
      >
        {/* ── Choose Mode ── */}
        {mode === 'choose' && (
          <div className="space-y-6">
            <div className="text-center">
              <img src={logo} alt="Club" className="h-16 object-contain rounded-2xl mx-auto mb-4" />
              <h1 className="text-2xl font-display font-bold">Join or Create a Club</h1>
              <p className="text-muted-foreground mt-2">Get started with your club</p>
            </div>
            <div className="space-y-3">
              <Button variant="gold" className="w-full" onClick={() => { setMode('create'); setCreateStep('type'); }}>
                <Plus className="w-4 h-4 mr-2" /> Create a New Club
              </Button>
              <Button variant="outline" className="w-full" onClick={() => setMode('join')}>
                <ArrowRight className="w-4 h-4 mr-2" /> Join with Code
              </Button>
            </div>
          </div>
        )}

        {/* ── Create Wizard ── */}
        {mode === 'create' && (
          <AnimatePresence mode="wait">
            <motion.div
              key={createStep}
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.25 }}
              className="space-y-6"
            >
              {/* Progress bar */}
              <div className="flex gap-1">
                {steps.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1 flex-1 rounded-full transition-all ${
                      i <= stepIndex ? 'bg-primary' : 'bg-muted'
                    }`}
                  />
                ))}
              </div>

              {/* Step: Club Type */}
              {createStep === 'type' && (
                <>
                  <div className="text-center">
                    <h2 className="text-2xl font-display font-bold">What kind of club?</h2>
                    <p className="text-muted-foreground mt-2">Choose your club type</p>
                  </div>
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={() => { setClubType('movie'); setBookChoice(null); setSelectedBook(null); }}
                      className={`w-full flex items-center gap-4 rounded-xl p-5 border transition-all ${
                        clubType === 'movie'
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-muted/10 hover:border-primary/50'
                      }`}
                    >
                      <Film className={`w-8 h-8 ${clubType === 'movie' ? 'text-primary' : 'text-muted-foreground'}`} />
                      <div className="text-left">
                        <span className="font-semibold text-base">Movie Club</span>
                        <p className="text-xs text-muted-foreground mt-0.5">Pick movies, guess who picked what, rank them</p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setClubType('book')}
                      className={`w-full flex items-center gap-4 rounded-xl p-5 border transition-all ${
                        clubType === 'book'
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-muted/10 hover:border-primary/50'
                      }`}
                    >
                      <BookOpen className={`w-8 h-8 ${clubType === 'book' ? 'text-primary' : 'text-muted-foreground'}`} />
                      <div className="text-left">
                        <span className="font-semibold text-base">Book Club</span>
                        <p className="text-xs text-muted-foreground mt-0.5">Pick books, track reading, rank and review</p>
                      </div>
                    </button>
                  </div>
                </>
              )}

              {/* Step: Club Name */}
              {createStep === 'name' && (
                <>
                  <div className="text-center">
                    <h2 className="text-2xl font-display font-bold">Name your club</h2>
                    <p className="text-muted-foreground mt-2">Give your {itemLabel} club a name</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="groupName">Club Name</Label>
                    <Input
                      id="groupName"
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      placeholder={clubType === 'movie' ? 'The Cinema Society' : 'The Book Corner'}
                      autoFocus
                      className="bg-muted/50 border-border text-lg"
                    />
                  </div>
                </>
              )}

              {/* Step: Meeting Format */}
              {createStep === 'meeting' && (
                <>
                  <div className="text-center">
                    <h2 className="text-2xl font-display font-bold">How do you meet?</h2>
                    <p className="text-muted-foreground mt-2">Choose your meeting format</p>
                  </div>
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={() => setMeetingType('remote')}
                      className={`w-full flex items-center gap-4 rounded-xl p-5 border transition-all ${
                        meetingType === 'remote'
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-muted/10 hover:border-primary/50'
                      }`}
                    >
                      <Video className={`w-7 h-7 ${meetingType === 'remote' ? 'text-primary' : 'text-muted-foreground'}`} />
                      <div className="text-left">
                        <span className="font-semibold">Remote / Video Call</span>
                        <p className="text-xs text-muted-foreground mt-0.5">Meet via Zoom, Google Meet, etc.</p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setMeetingType('in_person')}
                      className={`w-full flex items-center gap-4 rounded-xl p-5 border transition-all ${
                        meetingType === 'in_person'
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-muted/10 hover:border-primary/50'
                      }`}
                    >
                      <MapPin className={`w-7 h-7 ${meetingType === 'in_person' ? 'text-primary' : 'text-muted-foreground'}`} />
                      <div className="text-left">
                        <span className="font-semibold">In Person</span>
                        <p className="text-xs text-muted-foreground mt-0.5">Meet at a physical location</p>
                      </div>
                    </button>
                  </div>

                   {meetingType === 'in_person' && (
                    <p className="text-xs text-muted-foreground bg-muted/20 rounded-lg p-3">
                      📍 You can set a meeting location after creating your club from the admin panel.
                    </p>
                   )}
                </>
              )}

              {/* Step: Book Choice (book clubs only) */}
              {createStep === 'book_choice' && (
                <>
                  <div className="text-center">
                    <h2 className="text-2xl font-display font-bold">Do you have a book?</h2>
                    <p className="text-muted-foreground mt-2">Has your club already decided on a book to read?</p>
                  </div>
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={() => setBookChoice('chosen')}
                      className={`w-full flex items-center gap-4 rounded-xl p-5 border transition-all ${
                        bookChoice === 'chosen'
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-muted/10 hover:border-primary/50'
                      }`}
                    >
                      <BookMarked className={`w-7 h-7 ${bookChoice === 'chosen' ? 'text-primary' : 'text-muted-foreground'}`} />
                      <div className="text-left">
                        <span className="font-semibold">Yes, we have a book</span>
                        <p className="text-xs text-muted-foreground mt-0.5">Search and add your first book now</p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => { setBookChoice('vote'); setSelectedBook(null); }}
                      className={`w-full flex items-center gap-4 rounded-xl p-5 border transition-all ${
                        bookChoice === 'vote'
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-muted/10 hover:border-primary/50'
                      }`}
                    >
                      <Vote className={`w-7 h-7 ${bookChoice === 'vote' ? 'text-primary' : 'text-muted-foreground'}`} />
                      <div className="text-left">
                        <span className="font-semibold">Not yet, we'll decide later</span>
                        <p className="text-xs text-muted-foreground mt-0.5">Members can suggest and vote on books after setup</p>
                      </div>
                    </button>
                  </div>
                </>
              )}

              {/* Step: Book Search (book clubs, chosen) */}
              {createStep === 'book_search' && (
                <>
                  <div className="text-center">
                    <h2 className="text-2xl font-display font-bold">Find your book</h2>
                    <p className="text-muted-foreground mt-2">Search by title or author</p>
                  </div>

                  {selectedBook ? (
                    <div className="bg-primary/5 rounded-xl p-4 space-y-3">
                      <div className="flex items-start gap-3">
                        {selectedBook.volumeInfo.imageLinks?.thumbnail ? (
                          <img
                            src={selectedBook.volumeInfo.imageLinks.thumbnail.replace('http:', 'https:')}
                            alt={selectedBook.volumeInfo.title}
                            className="w-16 rounded-lg object-cover shrink-0"
                          />
                        ) : (
                          <div className="w-16 aspect-[2/3] bg-muted rounded-lg flex items-center justify-center shrink-0">
                            <BookOpen className="w-6 h-6 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <h3 className="font-semibold text-sm">{selectedBook.volumeInfo.title}</h3>
                              {selectedBook.volumeInfo.authors && (
                                <p className="text-xs text-muted-foreground">{selectedBook.volumeInfo.authors.join(', ')}</p>
                              )}
                              {selectedBook.volumeInfo.publishedDate && (
                                <p className="text-xs text-muted-foreground">{selectedBook.volumeInfo.publishedDate.split('-')[0]}</p>
                              )}
                              {selectedBook.volumeInfo.pageCount && (
                                <p className="text-xs text-muted-foreground">{selectedBook.volumeInfo.pageCount} pages</p>
                              )}
                            </div>
                            <button onClick={() => setSelectedBook(null)} className="text-muted-foreground hover:text-foreground">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-primary">
                        <Check className="w-3.5 h-3.5" />
                        <span>Selected as your first book</span>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex gap-2">
                        <Input
                          value={bookQuery}
                          onChange={(e) => setBookQuery(e.target.value)}
                          placeholder="Search for a book..."
                          className="bg-muted/50 border-border flex-1"
                          autoFocus
                          onKeyDown={(e) => e.key === 'Enter' && searchBooks()}
                        />
                        <Button variant="gold" onClick={() => searchBooks()} disabled={bookSearching}>
                          <Search className="w-4 h-4" />
                        </Button>
                      </div>

                      {bookSearching && (
                        <p className="text-sm text-muted-foreground text-center py-4">Searching...</p>
                      )}

                      {bookResults.length > 0 && (
                        <div className="space-y-1 max-h-[280px] overflow-y-auto rounded-xl border border-border bg-card/50 p-1">
                          {bookResults.map((book) => (
                            <button
                              key={book.id}
                              onClick={() => setSelectedBook(book)}
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

                      {bookQuery.trim().length > 0 && !bookSearching && bookResults.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-4">No books found. Try a different search.</p>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Step: Chapters (book clubs, book chosen) */}
              {createStep === 'chapters' && (
                <>
                  <div className="text-center">
                    <h2 className="text-2xl font-display font-bold">Chapter assignments</h2>
                    <p className="text-muted-foreground mt-2">
                      Would you like to set up which chapters to read for each meeting?
                    </p>
                  </div>
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={() => setChapterChoice('later')}
                      className={`w-full flex items-center gap-4 rounded-xl p-5 border transition-all ${
                        chapterChoice === 'later'
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-muted/10 hover:border-primary/50'
                      }`}
                    >
                      <CalendarClock className={`w-7 h-7 ${chapterChoice === 'later' ? 'text-primary' : 'text-muted-foreground'}`} />
                      <div className="text-left">
                        <span className="font-semibold">Decide later</span>
                        <p className="text-xs text-muted-foreground mt-0.5">You can set chapter assignments from the admin panel anytime</p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setChapterChoice('now')}
                      className={`w-full flex items-center gap-4 rounded-xl p-5 border transition-all ${
                        chapterChoice === 'now'
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-muted/10 hover:border-primary/50'
                      }`}
                    >
                      <BookOpen className={`w-7 h-7 ${chapterChoice === 'now' ? 'text-primary' : 'text-muted-foreground'}`} />
                      <div className="text-left">
                        <span className="font-semibold">Set up now</span>
                        <p className="text-xs text-muted-foreground mt-0.5">Assign chapter ranges for each meeting date</p>
                      </div>
                    </button>
                  </div>
                  {chapterChoice === 'now' && (
                    <p className="text-xs text-muted-foreground bg-muted/20 rounded-lg p-3">
                      📖 Chapter assignment will be available from the admin panel once your club is created. You'll be able to set chapter ranges for each due date there.
                    </p>
                  )}
                </>
              )}

              {/* Step: Confirmation */}
              {createStep === 'confirm' && (
                <>
                  <div className="text-center">
                    <h2 className="text-2xl font-display font-bold">Ready to go!</h2>
                    <p className="text-muted-foreground mt-2">Here's your club setup</p>
                  </div>
                  <div className="space-y-3 bg-muted/20 rounded-xl p-5">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Type</span>
                      <span className="font-medium flex items-center gap-2">
                        {clubType === 'movie' ? <Film className="w-4 h-4 text-primary" /> : <BookOpen className="w-4 h-4 text-primary" />}
                        {clubType === 'movie' ? 'Movie Club' : 'Book Club'}
                      </span>
                    </div>
                    <div className="border-t border-border" />
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Name</span>
                      <span className="font-medium">{groupName}</span>
                    </div>
                    <div className="border-t border-border" />
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Meetings</span>
                      <span className="font-medium flex items-center gap-2">
                        {meetingType === 'remote' ? <Video className="w-4 h-4 text-primary" /> : <MapPin className="w-4 h-4 text-primary" />}
                        {meetingType === 'remote' ? 'Remote' : 'In Person'}
                      </span>
                    </div>
                    {clubType === 'book' && (
                      <>
                        <div className="border-t border-border" />
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-muted-foreground">First Book</span>
                          <span className="font-medium flex items-center gap-2">
                            {selectedBook ? (
                              <>
                                <BookMarked className="w-4 h-4 text-primary" />
                                <span className="truncate max-w-[180px]">{selectedBook.volumeInfo.title}</span>
                              </>
                            ) : (
                              <span className="text-muted-foreground">To be decided</span>
                            )}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}

              {/* Navigation */}
              <div className="flex gap-3">
                <Button type="button" variant="ghost" onClick={goPrevStep}>
                  <ChevronLeft className="w-4 h-4 mr-1" /> Back
                </Button>
                {createStep === 'confirm' ? (
                  <Button
                    variant="gold"
                    className="flex-1"
                    disabled={loading}
                    onClick={handleCreateGroup}
                  >
                    {loading ? 'Creating...' : 'Create Club'}
                  </Button>
                ) : (
                  <Button
                    variant="gold"
                    className="flex-1"
                    disabled={!canProceed()}
                    onClick={goNextStep}
                  >
                    Continue <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        )}

        {/* ── Join with Code ── */}
        {mode === 'join' && (
          <form onSubmit={handleFindGroup} className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-display font-bold">Join a Club</h2>
              <p className="text-muted-foreground mt-2">Enter the code from your admin</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="joinCode">Join Code</Label>
              <Input
                id="joinCode"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="abc12def"
                required
                className="bg-muted/50 border-border font-mono tracking-widest text-center text-lg"
              />
            </div>
            <div className="flex gap-3">
              <Button type="button" variant="ghost" onClick={() => setMode('choose')}>Back</Button>
              <Button type="submit" variant="gold" className="flex-1" disabled={loading}>
                {loading ? 'Finding...' : 'Join Club'}
              </Button>
            </div>
          </form>
        )}

        {/* ── Claim placeholder ── */}
        {mode === 'claim' && (
          <div className="space-y-6">
            <div className="text-center">
              <UserCheck className="w-12 h-12 text-primary mx-auto mb-3" />
              <h2 className="text-2xl font-display font-bold">Which one are you?</h2>
              <p className="text-muted-foreground mt-2">Your admin created these member names. Tap yours to claim it.</p>
            </div>
            <div className="space-y-2">
              {placeholders.map((ph) => (
                <button
                  key={ph.user_id}
                  onClick={() => setSelectedPlaceholder(ph.user_id)}
                  className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${
                    selectedPlaceholder === ph.user_id
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-muted/10 hover:border-primary/50'
                  }`}
                >
                  <span className="font-medium">{ph.display_name}</span>
                </button>
              ))}
            </div>
            <div className="flex gap-3">
              <Button variant="ghost" onClick={() => { setMode('join'); setFoundGroupId(null); setSelectedPlaceholder(null); }}>Back</Button>
              <Button
                variant="gold"
                className="flex-1"
                disabled={!selectedPlaceholder || loading}
                onClick={() => selectedPlaceholder && foundGroupId && joinGroup(foundGroupId, selectedPlaceholder)}
              >
                {loading ? 'Joining...' : "That's Me!"}
              </Button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default GroupSetup;
