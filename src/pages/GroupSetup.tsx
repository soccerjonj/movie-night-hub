import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Film, Users, Plus, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

const GroupSetup = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'choose' | 'create' | 'join'>('choose');
  const [groupName, setGroupName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading] = useState(false);

  // Check if user already has a group
  useEffect(() => {
    const checkGroup = async () => {
      if (!user) return;
      const { data } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', user.id)
        .limit(1);
      if (data && data.length > 0) {
        navigate('/dashboard');
      }
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
      navigate('/dashboard');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleJoinGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    try {
      // Find group by join code using security definer function
      const { data: groups, error: findError } = await supabase
        .rpc('find_group_by_code', { _code: joinCode.trim().toLowerCase() });
      
      if (findError || !groups || groups.length === 0) {
        throw new Error('Invalid join code. Please check and try again.');
      }

      const { error: joinError } = await supabase
        .from('group_members')
        .insert({ group_id: groups[0].id, user_id: user.id });
      if (joinError) throw joinError;

      toast.success('Joined the group!');
      navigate('/dashboard');
    } catch (err: any) {
      toast.error(err.message);
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
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
                <Users className="w-8 h-8 text-primary" />
              </div>
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
          <form onSubmit={handleJoinGroup} className="space-y-6">
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
                {loading ? 'Joining...' : 'Join Club'}
              </Button>
            </div>
          </form>
        )}
      </motion.div>
    </div>
  );
};

export default GroupSetup;
