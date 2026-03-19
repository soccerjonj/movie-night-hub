import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Users, Plus, ArrowRight, Ghost, UserCheck, Film, BookOpen, Video, MapPin, ChevronRight, ChevronLeft } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import logo from '@/assets/logo.png';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { groupNameSchema, joinCodeSchema, getSafeErrorMessage } from '@/lib/security';

interface PlaceholderProfile {
  user_id: string;
  display_name: string;
}

type Mode = 'choose' | 'create' | 'join' | 'claim';
type CreateStep = 'type' | 'name' | 'meeting' | 'confirm';

const CREATE_STEPS: CreateStep[] = ['type', 'name', 'meeting', 'confirm'];

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

  // Join state
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [foundGroupId, setFoundGroupId] = useState<string | null>(null);
  const [placeholders, setPlaceholders] = useState<PlaceholderProfile[]>([]);
  const [selectedPlaceholder, setSelectedPlaceholder] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    // Don't auto-redirect — user may want to join another club
  }, [user, navigate]);

  const stepIndex = CREATE_STEPS.indexOf(createStep);

  const goNextStep = () => {
    const next = CREATE_STEPS[stepIndex + 1];
    if (next) setCreateStep(next);
  };

  const goPrevStep = () => {
    const prev = CREATE_STEPS[stepIndex - 1];
    if (prev) setCreateStep(prev);
    else setMode('choose');
  };

  const canProceed = () => {
    switch (createStep) {
      case 'type': return true;
      case 'name': return groupName.trim().length > 0;
      case 'meeting': return true;
      case 'confirm': return true;
      default: return false;
    }
  };

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

      // Flag for walkthrough
      localStorage.setItem(`show_walkthrough_${group.id}`, 'true');

      toast.success('Group created!');
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
                {CREATE_STEPS.map((_, i) => (
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
                      onClick={() => setClubType('movie')}
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

        {/* ── Claim Placeholder ── */}
        {mode === 'claim' && (
          <div className="space-y-6">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
                <UserCheck className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-2xl font-display font-bold">Who are you?</h2>
              <p className="text-muted-foreground mt-2">
                Select your name from the unclaimed member list below
              </p>
            </div>

            <div className="space-y-2">
              {placeholders.map((p) => (
                <button
                  key={p.user_id}
                  type="button"
                  onClick={() => setSelectedPlaceholder(p.user_id === selectedPlaceholder ? null : p.user_id)}
                  className={`w-full flex items-center gap-3 rounded-xl p-4 border transition-all ${
                    selectedPlaceholder === p.user_id
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-muted/10 hover:border-primary/50'
                  }`}
                >
                  <Ghost className={`w-5 h-5 ${selectedPlaceholder === p.user_id ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className="font-medium">{p.display_name}</span>
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-2">
              <Button
                variant="gold"
                className="w-full"
                disabled={loading || !selectedPlaceholder}
                onClick={() => foundGroupId && selectedPlaceholder && joinGroup(foundGroupId, selectedPlaceholder)}
              >
                {loading ? 'Joining...' : 'Claim & Join'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => { setMode('join'); setPlaceholders([]); setSelectedPlaceholder(null); }}>
                Back
              </Button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default GroupSetup;
