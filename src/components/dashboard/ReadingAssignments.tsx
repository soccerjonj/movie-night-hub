import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Trash2, CalendarClock, BookOpen, ListPlus } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

type ReadingAssignment = {
  id: string;
  season_id: string;
  title: string | null;
  chapter_range: string | null;
  start_page: number | null;
  end_page: number | null;
  due_date: string | null;
  notes: string | null;
  order_index: number;
};

interface Props {
  seasonId: string;
  isAdmin: boolean;
}

const formatDueDate = (value: string) => {
  const date = new Date(`${value}T00:00:00`);
  return format(date, 'MMM d, yyyy');
};

const ReadingAssignments = ({ seasonId, isAdmin }: Props) => {
  const [assignments, setAssignments] = useState<ReadingAssignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [keepOpen, setKeepOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [chapterStart, setChapterStart] = useState('');
  const [chapterEnd, setChapterEnd] = useState('');
  const [startPage, setStartPage] = useState('');
  const [endPage, setEndPage] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [meetingDates, setMeetingDates] = useState<{ meeting_index: number; meeting_at: string }[]>([]);

  const nextOrderIndex = useMemo(() => {
    return assignments.length > 0 ? Math.max(...assignments.map(a => a.order_index)) + 1 : 0;
  }, [assignments]);

  const resetForm = () => {
    setEditingId(null);
    setTitle('');
    setChapterStart('');
    setChapterEnd('');
    setStartPage('');
    setEndPage('');
    setDueDate('');
    setNotes('');
  };

  const fetchAssignments = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('reading_assignments')
        .select('*')
        .eq('season_id', seasonId)
        .order('order_index', { ascending: true })
        .order('due_date', { ascending: true });
      if (error) throw error;
      setAssignments((data || []) as ReadingAssignment[]);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to load reading assignments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAssignments();
  }, [seasonId]);

  useEffect(() => {
    const fetchMeetings = async () => {
      const { data } = await supabase
        .from('club_meetings')
        .select('meeting_index, meeting_at')
        .eq('season_id', seasonId)
        .order('meeting_index', { ascending: true });
      setMeetingDates((data || []) as { meeting_index: number; meeting_at: string }[]);
    };
    fetchMeetings();
  }, [seasonId]);

  const handleSave = async () => {
    if (!chapterStart.trim() && !chapterEnd.trim() && !title.trim() && !startPage.trim() && !endPage.trim()) {
      toast.error('Add a chapter range, page range, or title');
      return;
    }
    setLoading(true);
    try {
      const startPageNum = startPage.trim() ? Number(startPage) : null;
      const endPageNum = endPage.trim() ? Number(endPage) : null;
      const chapterStartNum = chapterStart.trim() ? Number(chapterStart) : null;
      const chapterEndNum = chapterEnd.trim() ? Number(chapterEnd) : null;
      const chapterRange = chapterStartNum || chapterEndNum
        ? `${chapterStartNum ?? '?'}–${chapterEndNum ?? '?'}`
        : null;
      const payload = {
        season_id: seasonId,
        title: title.trim() || null,
        chapter_range: chapterRange,
        start_page: Number.isFinite(startPageNum) ? startPageNum : null,
        end_page: Number.isFinite(endPageNum) ? endPageNum : null,
        due_date: dueDate || null,
        notes: notes.trim() || null,
        order_index: editingId ? undefined : nextOrderIndex,
      };
      const { error } = editingId
        ? await supabase.from('reading_assignments').update(payload).eq('id', editingId)
        : await supabase.from('reading_assignments').insert(payload);
      if (error) throw error;
      toast.success(editingId ? 'Reading updated' : 'Reading assigned');
      await fetchAssignments();
      if (keepOpen && !editingId) {
        resetForm();
        // Prefill next chapter/page starts
        const last = assignments[assignments.length - 1];
        if (last?.chapter_range) {
          const parts = last.chapter_range.split('–').map(p => parseInt(p.trim(), 10));
          const lastEnd = parts.length > 1 ? parts[1] : parts[0];
          if (Number.isFinite(lastEnd)) setChapterStart(String(lastEnd + 1));
        }
        if (last?.end_page && Number.isFinite(last.end_page)) {
          setStartPage(String(last.end_page + 1));
        }
      } else {
        resetForm();
        setDialogOpen(false);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save reading');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    setLoading(true);
    try {
      const { error } = await supabase.from('reading_assignments').delete().eq('id', id);
      if (error) throw error;
      setAssignments(prev => prev.filter(a => a.id !== id));
      toast.success('Reading removed');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove reading');
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (assignment: ReadingAssignment) => {
    setEditingId(assignment.id);
    setTitle(assignment.title ?? '');
    if (assignment.chapter_range) {
      const parts = assignment.chapter_range.split('–').map(p => p.trim());
      setChapterStart(parts[0] ?? '');
      setChapterEnd(parts[1] ?? '');
    } else {
      setChapterStart('');
      setChapterEnd('');
    }
    setStartPage(assignment.start_page != null ? String(assignment.start_page) : '');
    setEndPage(assignment.end_page != null ? String(assignment.end_page) : '');
    setDueDate(assignment.due_date ?? '');
    setNotes(assignment.notes ?? '');
    setDialogOpen(true);
  };

  const openAssignFirst = () => {
    const last = assignments[assignments.length - 1];
    if (last?.chapter_range) {
      const parts = last.chapter_range.split('–').map(p => parseInt(p.trim(), 10));
      const lastEnd = parts.length > 1 ? parts[1] : parts[0];
      if (Number.isFinite(lastEnd)) setChapterStart(String(lastEnd + 1));
    }
    if (last?.end_page && Number.isFinite(last.end_page)) {
      setStartPage(String(last.end_page + 1));
    }
    setKeepOpen(false);
    setDialogOpen(true);
  };

  const openAssignAll = () => {
    const last = assignments[assignments.length - 1];
    if (last?.chapter_range) {
      const parts = last.chapter_range.split('–').map(p => parseInt(p.trim(), 10));
      const lastEnd = parts.length > 1 ? parts[1] : parts[0];
      if (Number.isFinite(lastEnd)) setChapterStart(String(lastEnd + 1));
    }
    if (last?.end_page && Number.isFinite(last.end_page)) {
      setStartPage(String(last.end_page + 1));
    }
    setKeepOpen(true);
    setDialogOpen(true);
  };

  return (
    <div className="glass-card rounded-2xl p-4 sm:p-6 mt-4 sm:mt-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-primary" />
          <h3 className="font-display text-lg font-bold">Reading Assignments</h3>
        </div>
        {isAdmin && assignments.length > 0 && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" onClick={openAssignFirst}>
                <ListPlus className="w-4 h-4 mr-1" /> Add Reading
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[520px]">
              <DialogHeader>
                <DialogTitle>{editingId ? 'Edit reading assignment' : 'Add reading assignment'}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className="bg-muted/50" />
                <div className="flex gap-2">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={chapterStart}
                    onChange={(e) => setChapterStart(e.target.value)}
                    placeholder="Chapter start"
                    className="bg-muted/50"
                  />
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={chapterEnd}
                    onChange={(e) => setChapterEnd(e.target.value)}
                    placeholder="Chapter end"
                    className="bg-muted/50"
                  />
                </div>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={startPage}
                    onChange={(e) => setStartPage(e.target.value)}
                    placeholder="Start page"
                    className="bg-muted/50"
                  />
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={endPage}
                    onChange={(e) => setEndPage(e.target.value)}
                    placeholder="End page"
                    className="bg-muted/50"
                  />
                </div>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="bg-muted/50" />
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" className="bg-muted/50" />
                <div className="flex items-center gap-2">
                  <Checkbox id="keep-open" checked={keepOpen} onCheckedChange={(v) => setKeepOpen(Boolean(v))} />
                  <label htmlFor="keep-open" className="text-xs text-muted-foreground">Keep open to add another</label>
                </div>
                <Button variant="gold" onClick={handleSave} disabled={loading}>
                  {editingId ? 'Save changes' : 'Save reading'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {assignments.length === 0 ? (
        <div className="mt-4 text-sm text-muted-foreground">
          <p>No reading assignments yet.</p>
          {isAdmin && (
            <div className="flex flex-wrap gap-2 mt-3">
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="gold" size="sm" onClick={openAssignFirst}>
                    Assign First Reading
                  </Button>
                </DialogTrigger>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" onClick={openAssignAll}>
                    Assign All Readings
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[520px]">
                  <DialogHeader>
                    <DialogTitle>{editingId ? 'Edit reading assignment' : keepOpen ? 'Assign readings' : 'Assign first reading'}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className="bg-muted/50" />
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        value={chapterStart}
                        onChange={(e) => setChapterStart(e.target.value)}
                        placeholder="Chapter start"
                        className="bg-muted/50"
                      />
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        value={chapterEnd}
                        onChange={(e) => setChapterEnd(e.target.value)}
                        placeholder="Chapter end"
                        className="bg-muted/50"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        value={startPage}
                        onChange={(e) => setStartPage(e.target.value)}
                        placeholder="Start page"
                        className="bg-muted/50"
                      />
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        value={endPage}
                        onChange={(e) => setEndPage(e.target.value)}
                        placeholder="End page"
                        className="bg-muted/50"
                      />
                    </div>
                    <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="bg-muted/50" />
                    <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" className="bg-muted/50" />
                    <div className="flex items-center gap-2">
                      <Checkbox id="keep-open-first" checked={keepOpen} onCheckedChange={(v) => setKeepOpen(Boolean(v))} />
                      <label htmlFor="keep-open-first" className="text-xs text-muted-foreground">Keep open to add another</label>
                    </div>
                    <Button variant="gold" onClick={handleSave} disabled={loading}>
                      {editingId ? 'Save changes' : 'Save reading'}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
              {meetingDates.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    setLoading(true);
                    try {
                      const existing = new Set(assignments.map(a => a.order_index));
                      const rows = meetingDates
                        .filter((m) => !existing.has(m.meeting_index - 1))
                        .map((m) => ({
                          season_id: seasonId,
                          order_index: m.meeting_index - 1,
                          due_date: m.meeting_at.slice(0, 10),
                          title: null,
                        }));
                      if (rows.length === 0) {
                        toast.success('Readings already match meetings');
                      } else {
                        const { error } = await supabase.from('reading_assignments').insert(rows);
                        if (error) throw error;
                        toast.success('Readings generated from meetings');
                      }
                      await fetchAssignments();
                    } catch (err: unknown) {
                      toast.error(err instanceof Error ? err.message : 'Failed to generate readings');
                    } finally {
                      setLoading(false);
                    }
                  }}
                >
                  Generate from meetings
                </Button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {assignments.map((assignment, index) => {
            const titleText = assignment.title || `Reading ${index + 1}`;
            const chapterText = assignment.chapter_range ? `Chapters ${assignment.chapter_range}` : null;
            const pageText = assignment.start_page || assignment.end_page
              ? `Pages ${assignment.start_page ?? '?'}–${assignment.end_page ?? '?'}`
              : null;
            return (
              <div key={assignment.id} className="flex items-start gap-3 rounded-xl border border-border bg-card/50 p-3">
                <CalendarClock className="w-4 h-4 text-primary mt-1" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium">{titleText}</p>
                    {assignment.due_date && (
                      <span className="text-xs text-muted-foreground">Due {formatDueDate(assignment.due_date)}</span>
                    )}
                  </div>
                  {(chapterText || pageText) && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {chapterText || pageText}
                      {chapterText && pageText ? ` · ${pageText}` : ''}
                    </p>
                  )}
                  {assignment.notes && (
                    <p className="text-xs text-muted-foreground mt-1">{assignment.notes}</p>
                  )}
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => startEdit(assignment)}
                      disabled={loading}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDelete(assignment.id)}
                      disabled={loading}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ReadingAssignments;
