import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Group, GroupMember, Profile } from '@/hooks/useGroup';
import { getClubLabels } from '@/lib/clubTypes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Users, Link, Unlink, Sparkles, Shuffle, Tag, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  group: Group;
  members: GroupMember[];
  profiles: Profile[];
  currentSeasonNumber: number;
  onCreated: () => void;
}

interface ParticipantConfig {
  userId: string;
  selected: boolean;
  pickGroup: number | null; // null = solo, number = shared group
  constraint: string; // assigned constraint value
}

const CreateSeasonDialog = ({ group, members, profiles, currentSeasonNumber, onCreated }: Props) => {
  const labels = getClubLabels(group.club_type);
  const isBookClub = labels.type === 'book';
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Form state
  const [title, setTitle] = useState('');
  const [moviesPerMember, setMoviesPerMember] = useState(1);
  const [watchIntervalDays, setWatchIntervalDays] = useState(7);
  const [guessingEnabled, setGuessingEnabled] = useState(true);
  const [watchDeadlineDay, setWatchDeadlineDay] = useState('monday'); // day of week or day of month
  const [watchDeadlineTime, setWatchDeadlineTime] = useState('19:30');
  const [participants, setParticipants] = useState<ParticipantConfig[]>([]);
  const [nextGroupId, setNextGroupId] = useState(1);

  // Constraints
  const [constraintsEnabled, setConstraintsEnabled] = useState(false);
  const [constraintsVisible, setConstraintsVisible] = useState(true);
  const [constraintValues, setConstraintValues] = useState<string[]>(['']);
  const [newConstraint, setNewConstraint] = useState('');

  const getProfile = (userId: string) => profiles.find(p => p.user_id === userId);

  const resetForm = () => {
    setTitle('');
    setMoviesPerMember(1);
    setWatchIntervalDays(7);
    setGuessingEnabled(isBookClub ? false : true);
    setWatchDeadlineDay('monday');
    setWatchDeadlineTime('19:30');
    setNextGroupId(1);
    setConstraintsEnabled(false);
    setConstraintsVisible(true);
    setConstraintValues(['']);
    setNewConstraint('');
    // Initialize all members as selected, no groups
    setParticipants(
      members.map(m => ({ userId: m.user_id, selected: true, pickGroup: null, constraint: '' }))
    );
  };

  const handleOpen = (isOpen: boolean) => {
    if (isOpen) resetForm();
    setOpen(isOpen);
  };

  const toggleMember = (userId: string) => {
    setParticipants(prev => prev.map(p =>
      p.userId === userId ? { ...p, selected: !p.selected, pickGroup: !p.selected ? p.pickGroup : null, constraint: !p.selected ? p.constraint : '' } : p
    ));
  };

  const selectedParticipants = participants.filter(p => p.selected);
  const groups = [...new Set(selectedParticipants.filter(p => p.pickGroup !== null).map(p => p.pickGroup))].sort();

  const createGroup = () => {
    // Find selected members without a group
    const ungrouped = selectedParticipants.filter(p => p.pickGroup === null);
    if (ungrouped.length < 2) {
      toast.error('Need at least 2 ungrouped members to create a co-pick group');
      return;
    }
    // Group the first 2 ungrouped members
    const toGroup = ungrouped.slice(0, 2);
    const gId = nextGroupId;
    setNextGroupId(prev => prev + 1);
    setParticipants(prev => prev.map(p =>
      toGroup.some(g => g.userId === p.userId) ? { ...p, pickGroup: gId } : p
    ));
  };

  const addToGroup = (userId: string, groupNum: number) => {
    setParticipants(prev => prev.map(p =>
      p.userId === userId ? { ...p, pickGroup: groupNum } : p
    ));
  };

  const removeFromGroup = (userId: string) => {
    setParticipants(prev => {
      const updated = prev.map(p =>
        p.userId === userId ? { ...p, pickGroup: null } : p
      );
      // Clean up groups that now have only 1 member
      const groupCounts: Record<number, number> = {};
      updated.forEach(p => { if (p.pickGroup !== null) groupCounts[p.pickGroup] = (groupCounts[p.pickGroup] || 0) + 1; });
      return updated.map(p => {
        if (p.pickGroup !== null && groupCounts[p.pickGroup] < 2) return { ...p, pickGroup: null };
        return p;
      });
    });
  };

  // Calculate total picks
  const soloCount = selectedParticipants.filter(p => p.pickGroup === null).length;
  const uniqueGroups = [...new Set(selectedParticipants.filter(p => p.pickGroup !== null).map(p => p.pickGroup))];
  const totalPickSlots = (soloCount + uniqueGroups.length) * moviesPerMember;

  // Constraint helpers
  const addConstraint = () => {
    const val = newConstraint.trim();
    if (!val) return;
    if (constraintValues.includes(val)) { toast.error('Duplicate constraint'); return; }
    setConstraintValues(prev => [...prev.filter(v => v), val]);
    setNewConstraint('');
  };

  const removeConstraint = (index: number) => {
    const removed = constraintValues[index];
    setConstraintValues(prev => prev.filter((_, i) => i !== index));
    // Clear from any participants who had it
    setParticipants(prev => prev.map(p => p.constraint === removed ? { ...p, constraint: '' } : p));
  };

  const assignConstraintToParticipant = (userId: string, value: string) => {
    setParticipants(prev => prev.map(p => p.userId === userId ? { ...p, constraint: value } : p));
  };

  const randomizeConstraints = () => {
    const validConstraints = constraintValues.filter(v => v.trim());
    if (validConstraints.length === 0) { toast.error('Add constraints first'); return; }
    // Shuffle constraints and assign round-robin to selected participants
    const shuffled = [...validConstraints].sort(() => Math.random() - 0.5);
    setParticipants(prev => {
      let idx = 0;
      return prev.map(p => {
        if (!p.selected) return p;
        const constraint = shuffled[idx % shuffled.length];
        idx++;
        return { ...p, constraint };
      });
    });
    toast.success('Constraints randomized!');
  };

  const handleCreate = async () => {
    if (selectedParticipants.length < 1) {
      toast.error('Select at least one member');
      return;
    }

    setLoading(true);
    try {
      const seasonNumber = currentSeasonNumber + 1;

      // Create season
      const { data: seasonData, error: seasonError } = await supabase
        .from('seasons')
        .insert({
          group_id: group.id,
          season_number: seasonNumber,
          title: title.trim() || null,
          status: 'picking' as const,
          movies_per_member: moviesPerMember,
          watch_interval_days: watchIntervalDays,
          guessing_enabled: guessingEnabled,
        })
        .select('id')
        .single();

      if (seasonError) throw seasonError;

      // Insert participants
      const participantRows = selectedParticipants.map(p => ({
        season_id: seasonData.id,
        user_id: p.userId,
        pick_group: p.pickGroup,
        pick_constraint: constraintsEnabled && p.constraint ? p.constraint : null,
      }));

      const { error: partError } = await supabase
        .from('season_participants')
        .insert(participantRows);

      if (partError) throw partError;

      toast.success(`${labels.seasonNoun} ${seasonNumber} created!`);
      setOpen(false);
      onCreated();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : `Failed to create ${labels.seasonNoun.toLowerCase()}`);
    } finally {
      setLoading(false);
    }
  };

  const groupLetters = 'ABCDEFGHIJKLMNOP';
  const getGroupLabel = (groupNum: number) => {
    const idx = uniqueGroups.indexOf(groupNum);
    return idx >= 0 ? groupLetters[idx] : '?';
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="gold" size="sm">
          <Plus className="w-4 h-4 mr-1" /> Create New {labels.seasonNoun}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Create New {labels.seasonNoun}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Season Theme */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-primary" /> {labels.seasonNoun} Theme
            </Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={isBookClub ? "e.g. Sci-Fi Month, Classic Literature..." : "e.g. Horror Month, 90s Classics, Studio Ghibli..."}
              className="bg-muted/50 text-base font-medium"
            />
            <p className="text-xs text-muted-foreground">This will be displayed prominently while members pick their {labels.items}.</p>
          </div>

          {/* Who's Picking */}
          <div className="space-y-3">
            <Label className="text-sm font-semibold flex items-center gap-1.5">
              <Users className="w-4 h-4 text-primary" /> Who's Picking?
            </Label>
            <div className="space-y-1.5">
              {participants.map((p) => {
                const profile = getProfile(p.userId);
                return (
                  <div key={p.userId} className={`flex items-center justify-between rounded-lg px-3 py-2 transition-colors ${p.selected ? 'bg-primary/5' : 'bg-muted/10 opacity-50'}`}>
                    <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                      <input
                        type="checkbox"
                        checked={p.selected}
                        onChange={() => toggleMember(p.userId)}
                        className="rounded border-border"
                      />
                      <span className="text-sm truncate">{profile?.display_name || 'Unknown'}</span>
                    </label>
                    {p.selected && p.pickGroup !== null && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-xs font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                          Group {getGroupLabel(p.pickGroup)}
                        </span>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeFromGroup(p.userId)}>
                          <Unlink className="w-3 h-3" />
                        </Button>
                      </div>
                    )}
                    {p.selected && p.pickGroup === null && groups.length > 0 && (
                      <Select onValueChange={(v) => addToGroup(p.userId, Number(v))}>
                        <SelectTrigger className="w-24 h-7 text-xs">
                          <SelectValue placeholder="Solo" />
                        </SelectTrigger>
                        <SelectContent>
                          {uniqueGroups.map(g => (
                            <SelectItem key={g} value={String(g)}>Group {getGroupLabel(g!)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                );
              })}
            </div>
            <Button variant="outline" size="sm" onClick={createGroup} disabled={selectedParticipants.filter(p => p.pickGroup === null).length < 2}>
              <Link className="w-3 h-3 mr-1" /> Create Co-Pick Group
            </Button>
            <p className="text-xs text-muted-foreground">Members in the same group share a single pick.</p>
          </div>

          {/* Pick Constraints */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold flex items-center gap-1.5">
                <Tag className="w-4 h-4 text-primary" /> Pick Constraints
              </Label>
              <Switch checked={constraintsEnabled} onCheckedChange={setConstraintsEnabled} />
            </div>
            {constraintsEnabled && (
              <div className="space-y-3 bg-muted/10 rounded-lg p-3">
                <p className="text-xs text-muted-foreground">
                  Define constraints (e.g. decades, genres, directors) and assign one to each member.
                </p>
                <div className="space-y-1.5">
                  {constraintValues.filter(v => v).map((val, i) => (
                    <div key={i} className="flex items-center gap-2 bg-background rounded-md px-2.5 py-1.5">
                      <span className="text-sm flex-1">{val}</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => removeConstraint(i)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={newConstraint}
                    onChange={(e) => setNewConstraint(e.target.value)}
                    placeholder="e.g. 1980s, Horror, Spielberg..."
                    className="bg-background text-sm flex-1"
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addConstraint(); } }}
                  />
                  <Button variant="outline" size="sm" onClick={addConstraint} disabled={!newConstraint.trim()}>
                    <Plus className="w-3 h-3 mr-1" /> Add
                  </Button>
                </div>
                {constraintValues.filter(v => v).length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-border">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">Assign to members</span>
                      <Button variant="outline" size="sm" onClick={randomizeConstraints} className="text-xs h-7">
                        <Shuffle className="w-3 h-3 mr-1" /> Randomize
                      </Button>
                    </div>
                    <div className="space-y-1.5">
                      {selectedParticipants.map((p) => {
                        const profile = getProfile(p.userId);
                        const validConstraints = constraintValues.filter(v => v.trim());
                        return (
                          <div key={p.userId} className="flex items-center gap-2">
                            <span className="text-sm truncate flex-1 min-w-0">{profile?.display_name || 'Unknown'}</span>
                            <Select value={p.constraint || ''} onValueChange={(v) => assignConstraintToParticipant(p.userId, v)}>
                              <SelectTrigger className="w-36 h-8 text-xs">
                                <SelectValue placeholder="Unassigned" />
                              </SelectTrigger>
                              <SelectContent>
                                {validConstraints.map((c) => (
                                  <SelectItem key={c} value={c}>{c}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Movies Per Member */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">{labels.Items} Per Pick Slot</Label>
            <div className="flex items-center gap-3">
              <Select value={String(moviesPerMember)} onValueChange={(v) => setMoviesPerMember(Number(v))}>
                <SelectTrigger className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map(n => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">
                = {totalPickSlots} total {labels.item}{totalPickSlots !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-sm font-semibold">{labels.Watch} Schedule</Label>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-muted-foreground">{labels.Watch} 1 {labels.item} every</span>
              <Select value={String(watchIntervalDays)} onValueChange={(v) => setWatchIntervalDays(Number(v))}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 day</SelectItem>
                  <SelectItem value="2">2 days</SelectItem>
                  <SelectItem value="3">3 days</SelectItem>
                  <SelectItem value="4">4 days</SelectItem>
                  <SelectItem value="5">5 days</SelectItem>
                  <SelectItem value="6">6 days</SelectItem>
                  <SelectItem value="7">1 week</SelectItem>
                  <SelectItem value="10">10 days</SelectItem>
                  <SelectItem value="14">2 weeks</SelectItem>
                  <SelectItem value="21">3 weeks</SelectItem>
                  <SelectItem value="30">1 month</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-muted-foreground">Due by</span>
              {watchIntervalDays >= 7 ? (
                <Select value={watchDeadlineDay} onValueChange={setWatchDeadlineDay}>
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {watchIntervalDays >= 28 ? (
                      <>
                        {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                          <SelectItem key={d} value={String(d)}>
                            {d === 1 ? '1st' : d === 2 ? '2nd' : d === 3 ? '3rd' : `${d}th`} of month
                          </SelectItem>
                        ))}
                      </>
                    ) : (
                      <>
                        <SelectItem value="monday">Monday</SelectItem>
                        <SelectItem value="tuesday">Tuesday</SelectItem>
                        <SelectItem value="wednesday">Wednesday</SelectItem>
                        <SelectItem value="thursday">Thursday</SelectItem>
                        <SelectItem value="friday">Friday</SelectItem>
                        <SelectItem value="saturday">Saturday</SelectItem>
                        <SelectItem value="sunday">Sunday</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              ) : (
                <span className="text-sm text-muted-foreground">end of day</span>
              )}
              <span className="text-sm text-muted-foreground">at</span>
              <Input
                type="time"
                value={watchDeadlineTime}
                onChange={(e) => setWatchDeadlineTime(e.target.value)}
                className="w-28 bg-muted/50"
              />
            </div>
          </div>
          {!isBookClub && (
            <div className="flex items-center justify-between rounded-lg bg-muted/10 px-4 py-3">
              <div>
                <Label className="text-sm font-semibold">Guessing Round</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Members guess who picked each {labels.item}</p>
              </div>
              <Switch checked={guessingEnabled} onCheckedChange={setGuessingEnabled} />
            </div>
          )}

          {/* Summary + Create */}
          <div className="border-t border-border pt-4 space-y-3">
            <div className="text-sm text-muted-foreground space-y-1">
              <p><strong>{selectedParticipants.length}</strong> member{selectedParticipants.length !== 1 ? 's' : ''} picking{uniqueGroups.length > 0 ? ` (${uniqueGroups.length} co-pick group${uniqueGroups.length !== 1 ? 's' : ''})` : ''}</p>
              <p><strong>{totalPickSlots}</strong> total {labels.item}{totalPickSlots !== 1 ? 's' : ''} to {labels.watch}</p>
              <p>1 {labels.item} every <strong>{watchIntervalDays === 1 ? 'day' : watchIntervalDays === 7 ? 'week' : watchIntervalDays === 14 ? '2 weeks' : watchIntervalDays === 21 ? '3 weeks' : watchIntervalDays === 30 ? 'month' : `${watchIntervalDays} days`}</strong>
                {watchIntervalDays >= 7 && <>, due by <strong>{watchIntervalDays >= 28 ? `the ${watchDeadlineDay}${watchDeadlineDay === '1' ? 'st' : watchDeadlineDay === '2' ? 'nd' : watchDeadlineDay === '3' ? 'rd' : 'th'}` : watchDeadlineDay.charAt(0).toUpperCase() + watchDeadlineDay.slice(1)}</strong></>}
                {' '}at <strong>{watchDeadlineTime}</strong>
              </p>
              {!guessingEnabled && <p className="text-amber-500">Guessing round disabled</p>}
            </div>
            <Button
              variant="gold"
              className="w-full"
              onClick={handleCreate}
              disabled={loading || selectedParticipants.length < 1}
            >
            {loading ? 'Creating...' : `Create ${labels.seasonNoun} ${currentSeasonNumber + 1}${title ? ` — ${title}` : ''}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CreateSeasonDialog;
