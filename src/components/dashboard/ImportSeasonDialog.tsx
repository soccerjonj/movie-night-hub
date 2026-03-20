import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Profile, Group } from '@/hooks/useGroup';
import { getClubLabels } from '@/lib/clubTypes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Upload, Plus, Trash2, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  group: Group;
  profiles: Profile[];
  existingSeasonCount: number;
  onImported: () => void;
}

interface ImportMovie {
  title: string;
  pickedBy: string[]; // user_ids
  year?: string;
}

const ImportSeasonDialog = ({ group, profiles, existingSeasonCount, onImported }: Props) => {
  const labels = getClubLabels(group.club_type);
  const [open, setOpen] = useState(false);
  const [seasonNumber, setSeasonNumber] = useState(String(existingSeasonCount + 1));
  const [seasonTitle, setSeasonTitle] = useState('');
  const [movies, setMovies] = useState<ImportMovie[]>([{ title: '', pickedBy: [], year: '' }]);
  const [seasonStatus, setSeasonStatus] = useState<'completed' | 'watching' | 'picking' | 'guessing'>('completed');
  const [currentMovieIndex, setCurrentMovieIndex] = useState('0');
  const [importing, setImporting] = useState(false);

  const addMovie = () => {
    setMovies([...movies, { title: '', pickedBy: [], year: '' }]);
  };

  const removeMovie = (index: number) => {
    setMovies(movies.filter((_, i) => i !== index));
  };

  const updateMovie = (index: number, field: 'title' | 'year', value: string) => {
    const updated = [...movies];
    updated[index] = { ...updated[index], [field]: value };
    setMovies(updated);
  };

  const togglePicker = (movieIndex: number, userId: string) => {
    const updated = [...movies];
    const current = updated[movieIndex].pickedBy;
    if (current.includes(userId)) {
      updated[movieIndex] = { ...updated[movieIndex], pickedBy: current.filter(id => id !== userId) };
    } else {
      updated[movieIndex] = { ...updated[movieIndex], pickedBy: [...current, userId] };
    }
    setMovies(updated);
  };

  const getPickerNames = (pickedBy: string[]) => {
    if (pickedBy.length === 0) return null;
    return pickedBy.map(id => memberProfiles.find(p => p.user_id === id)?.display_name || '?').join(' & ');
  };

  const handleImport = async () => {
    const parsedSeasonNumber = Number.parseInt(seasonNumber, 10);
    if (!Number.isInteger(parsedSeasonNumber) || parsedSeasonNumber < 1) {
      toast.error(`${labels.seasonNoun} number must be a positive integer`);
      return;
    }

    const validMovies = movies.filter(m => m.title.trim() && m.pickedBy.length > 0);
    if (validMovies.length === 0) {
      toast.error(`Add at least one ${labels.item} with a picker`);
      return;
    }

    setImporting(true);
    try {
      const movieIndex = seasonStatus === 'completed'
        ? validMovies.length - 1
        : Math.max(0, Math.min((Number.parseInt(currentMovieIndex, 10) || 1) - 1, validMovies.length - 1));

      const { data: seasonData, error: seasonError } = await supabase
        .from('seasons')
        .insert({
          group_id: group.id,
          season_number: parsedSeasonNumber,
          title: seasonTitle.trim() || null,
          status: seasonStatus,
          current_movie_index: movieIndex,
        })
        .select()
        .single();

      if (seasonError) throw seasonError;

      // Create one pick per user per movie (for co-picks, same movie gets multiple rows)
      const picks = validMovies.flatMap((movie, i) =>
        movie.pickedBy.map(userId => ({
          season_id: seasonData.id,
          user_id: userId,
          title: movie.title.trim(),
          year: movie.year?.trim() || null,
          watch_order: i,
          revealed: true,
          poster_url: null,
          tmdb_id: null,
          overview: null,
        }))
      );

      const { error: picksError } = await supabase.from('movie_picks').insert(picks);
      if (picksError) throw picksError;

      toast.success(`${labels.seasonNoun} ${seasonNumber} imported with ${validMovies.length} ${labels.items}!`);
      setOpen(false);
      setMovies([{ title: '', pickedBy: [], year: '' }]);
      onImported();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : `Failed to import ${labels.seasonNoun.toLowerCase()}`);
    } finally {
      setImporting(false);
    }
  };

  const memberProfiles = profiles.filter(p => p.display_name);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="w-4 h-4 mr-1" /> Import {labels.seasonNoun}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">Import {labels.seasonNoun}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Season Number & Title */}
          <div className="flex gap-3">
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">{labels.seasonNoun} #</label>
              <Input
                type="number"
                value={seasonNumber}
                onChange={(e) => setSeasonNumber(e.target.value)}
                className="w-20 bg-muted/50"
                min={1}
              />
            </div>
            <div className="flex-1">
              <label className="text-sm font-medium text-muted-foreground mb-1 block">Title (optional)</label>
              <Input
                value={seasonTitle}
                onChange={(e) => setSeasonTitle(e.target.value)}
                placeholder="e.g. Horror Month"
                className="bg-muted/50"
              />
            </div>
          </div>

          {/* Status & Current Movie */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-sm font-medium text-muted-foreground mb-1 block">Status</label>
              <Select value={seasonStatus} onValueChange={(v) => setSeasonStatus(v as typeof seasonStatus)}>
                <SelectTrigger className="bg-muted/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="completed">✅ Completed</SelectItem>
                  <SelectItem value="watching">🍿 Watching</SelectItem>
                  <SelectItem value="guessing">🔮 Guessing</SelectItem>
                  <SelectItem value="picking">🎬 Picking</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {seasonStatus === 'watching' && (
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1 block">Current {labels.Item} #</label>
                <Input
                  type="number"
                  value={currentMovieIndex}
                  onChange={(e) => setCurrentMovieIndex(e.target.value)}
                  className="w-24 bg-muted/50"
                  min={1}
                  placeholder="1"
                />
                <p className="text-xs text-muted-foreground mt-0.5">Which movie are you on?</p>
              </div>
            )}
          </div>

          {/* Movies */}
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-2 block">
              Movies (in watch order, top to bottom)
            </label>
            <div className="space-y-3">
              {movies.map((movie, i) => (
                <div key={i} className="flex items-start gap-2 bg-muted/20 rounded-lg p-3">
                  <span className="text-xs text-muted-foreground mt-2.5 w-5 shrink-0">{i + 1}.</span>
                  <div className="flex-1 space-y-2">
                    <div className="flex gap-2">
                      <Input
                        value={movie.title}
                        onChange={(e) => updateMovie(i, 'title', e.target.value)}
                        placeholder="Movie title"
                        className="bg-muted/50 flex-1"
                      />
                      <Input
                        value={movie.year || ''}
                        onChange={(e) => updateMovie(i, 'year', e.target.value)}
                        placeholder="Year"
                        className="bg-muted/50 w-20"
                      />
                    </div>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-between bg-muted/50 font-normal">
                          {getPickerNames(movie.pickedBy) || <span className="text-muted-foreground">Who picked this?</span>}
                          <ChevronDown className="w-4 h-4 ml-2 text-muted-foreground" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-56 p-2" align="start">
                        {memberProfiles.map((p) => (
                          <label
                            key={p.user_id}
                            className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 cursor-pointer"
                          >
                            <Checkbox
                              checked={movie.pickedBy.includes(p.user_id)}
                              onCheckedChange={() => togglePicker(i, p.user_id)}
                            />
                            <span className="text-sm">{p.display_name}</span>
                          </label>
                        ))}
                      </PopoverContent>
                    </Popover>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 mt-0.5 text-muted-foreground hover:text-destructive"
                    onClick={() => removeMovie(i)}
                    disabled={movies.length === 1}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>

            <Button variant="ghost" size="sm" onClick={addMovie} className="mt-2 text-muted-foreground">
              <Plus className="w-4 h-4 mr-1" /> Add Movie
            </Button>
          </div>

          <Button
            variant="gold"
            className="w-full"
            onClick={handleImport}
            disabled={importing}
          >
            {importing ? 'Importing...' : `Import ${labels.seasonNoun} ${seasonNumber}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ImportSeasonDialog;
