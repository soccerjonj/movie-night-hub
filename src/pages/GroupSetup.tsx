import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Users, Plus, ArrowRight, Ghost, UserCheck } from 'lucide-react';
import logo from '@/assets/logo.png';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

interface PlaceholderProfile {
  user_id: string;
  display_name: string;
}

const getErrorMessage = (err: unknown, fallback: string) => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const maybeMessage = (err as { message?: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) return maybeMessage;
  }
  return fallback;
};

const GroupSetup = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'choose' | 'create' | 'join' | 'claim'>('choose');
  const [groupName, setGroupName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [foundGroupId, setFoundGroupId] = useState<string | null>(null);
  const [placeholders, setPlaceholders] = useState<PlaceholderProfile[]>([]);
  const [selectedPlaceholder, setSelectedPlaceholder] = useState<string | null>(null);

  // Check if user already has groups — redirect to club select
  useEffect(() => {
    const checkGroup = async () => {
      if (!user) return;
      const { data } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', user.id)
        .limit(1);
      // Don't auto-redirect — user may want to join another club
    };
    checkGroup();
  }, [user, navigate]);

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    try {
      const { data: group, error: groupError } = await supabase
        .from('groups')
        .insert({ name: groupName, admin_user_id: user.id })
        .select()
        .single();
      if (groupError) throw groupError;

      const { error: memberError } = await supabase
        .from('group_members')
        .insert({ group_id: group.id, user_id: user.id });
      if (memberError) throw memberError;

      toast.success('Group created!');
      navigate('/clubs');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to create group'));
    } finally {
      setLoading(false);
    }
  };

  const handleFindGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    try {
      const { data: groups, error: findError } = await supabase
        .rpc('find_group_by_code', { _code: joinCode.trim().toLowerCase() });

      if (findError || !groups || groups.length === 0) {
        throw new Error('Invalid join code. Please check and try again.');
      }

      const groupId = groups[0].id;
      setFoundGroupId(groupId);

      // Fetch placeholder members through a security definer RPC so non-members can see claimable names.
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
      toast.error(getErrorMessage(err, 'Failed to find group'));
    } finally {
      setLoading(false);
    }
  };

  const joinGroup = async (groupId: string, placeholderUserId: string) => {
    if (!user) return;
    setLoading(true);
    try {
      // Claim the placeholder assigned by admin
      const { error } = await supabase.rpc('claim_placeholder', {
        _placeholder_user_id: placeholderUserId,
        _real_user_id: user.id,
        _group_id: groupId,
      });
      if (error) throw error;
      toast.success('Joined the group!');
      navigate('/clubs');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to join group'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-primary/5 blur-[120px]" />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="glass-card rounded-2xl p-8 w-full max-w-md mx-4 relative z-10"
      >
        {mode === 'choose' && (
          <div className="space-y-6">
            <div className="text-center">
              <img src={logo} alt="Movie Club" className="h-16 object-contain rounded-2xl mx-auto mb-4" />
              <h1 className="text-2xl font-display font-bold">Join or Create a Club</h1>
              <p className="text-muted-foreground mt-2">Get started with your movie club</p>
            </div>
            <div className="space-y-3">
              <Button variant="gold" className="w-full" onClick={() => setMode('create')}>
                <Plus className="w-4 h-4 mr-2" /> Create a New Club
              </Button>
              <Button variant="outline" className="w-full" onClick={() => setMode('join')}>
                <ArrowRight className="w-4 h-4 mr-2" /> Join with Code
              </Button>
            </div>
          </div>
        )}

        {mode === 'create' && (
          <form onSubmit={handleCreateGroup} className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-display font-bold">Create Your Club</h2>
              <p className="text-muted-foreground mt-2">Name your movie club</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="groupName">Club Name</Label>
              <Input
                id="groupName"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="The Cinema Society"
                required
                className="bg-muted/50 border-border"
              />
            </div>
            <div className="flex gap-3">
              <Button type="button" variant="ghost" onClick={() => setMode('choose')}>Back</Button>
              <Button type="submit" variant="gold" className="flex-1" disabled={loading}>
                {loading ? 'Creating...' : 'Create Club'}
              </Button>
            </div>
          </form>
        )}

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
