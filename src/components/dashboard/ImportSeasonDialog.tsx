import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Profile, Group } from '@/hooks/useGroup';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, Plus, Trash2, GripVertical } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  group: Group;
  profiles: Profile[];
  existingSeasonCount: number;
  onImported: () => void;
}

interface ImportMovie {
  title: string;
  pickedBy: string; // user_id
  year?: string;
}

const ImportSeasonDialog = ({ group, profiles, existingSeasonCount, onImported }: Props) => {
  const [open, setOpen] = useState(false);
  const [seasonNumber, setSeasonNumber] = useState(String(existingSeasonCount + 1));
  const [seasonTitle, setSeasonTitle] = useState('');
  const [movies, setMovies] = useState<ImportMovie[]>([{ title: '', pickedBy: '', year: '' }]);
  const [importing, setImporting] = useState(false);

  const addMovie = () => {
    setMovies([...movies, { title: '', pickedBy: '', year: '' }]);
  };

  const removeMovie = (index: number) => {
    setMovies(movies.filter((_, i) => i !== index));
  };

  const updateMovie = (index: number, field: keyof ImportMovie, value: string) => {
    const updated = [...movies];
    updated[index] = { ...updated[index], [field]: value };
    setMovies(updated);
  };

  const handleImport = async () => {
    const parsedSeasonNumber = Number.parseInt(seasonNumber, 10);
    if (!Number.isInteger(parsedSeasonNumber) || parsedSeasonNumber < 1) {
      toast.error('Season number must be a positive integer');
      return;
    }

    const validMovies = movies.filter(m => m.title.trim() && m.pickedBy);
    if (validMovies.length === 0) {
      toast.error('Add at least one movie with a picker');
      return;
    }

    setImporting(true);
    try {
      // Create the season as completed
      const { data: seasonData, error: seasonError } = await supabase
        .from('seasons')
        .insert({
          group_id: group.id,
          season_number: parsedSeasonNumber,
          title: seasonTitle.trim() || null,
          status: 'completed',
          current_movie_index: validMovies.length - 1,
        })
        .select()
        .single();

      if (seasonError) throw seasonError;

      // Insert all movie picks with watch order and revealed
      const picks = validMovies.map((movie, i) => ({
        season_id: seasonData.id,
        user_id: movie.pickedBy,
        title: movie.title.trim(),
        year: movie.year?.trim() || null,
        watch_order: i,
        revealed: true,
        poster_url: null,
        tmdb_id: null,
        overview: null,
      }));

      const { error: picksError } = await supabase.from('movie_picks').insert(picks);
      if (picksError) throw picksError;

      toast.success(`Season ${seasonNumber} imported with ${validMovies.length} movies!`);
      setOpen(false);
      setMovies([{ title: '', pickedBy: '', year: '' }]);
      onImported();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to import season');
    } finally {
      setImporting(false);
    }
  };

  // Get group member profiles only
  const memberProfiles = profiles.filter(p =>
    // We show all profiles; in practice these should be group members
    p.display_name
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="w-4 h-4 mr-1" /> Import Past Season
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">Import Past Season</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Season Number & Title */}
          <div className="flex gap-3">
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">Season #</label>
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
                    <Select
                      value={movie.pickedBy}
                      onValueChange={(v) => updateMovie(i, 'pickedBy', v)}
                    >
                      <SelectTrigger className="bg-muted/50">
                        <SelectValue placeholder="Who picked this?" />
                      </SelectTrigger>
                      <SelectContent>
                        {memberProfiles.map((p) => (
                          <SelectItem key={p.user_id} value={p.user_id}>
                            {p.display_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
            {importing ? 'Importing...' : `Import Season ${seasonNumber}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ImportSeasonDialog;
