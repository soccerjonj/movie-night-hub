import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Film, Plus, Users, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';

interface GroupInfo {
  id: string;
  name: string;
  member_count: number;
}

const ClubSelect = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchGroups = async () => {
      if (!user) return;
      setLoading(true);

      // Get all groups the user is a member of
      const { data: memberships } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', user.id);

      if (!memberships || memberships.length === 0) {
        // No groups — send to setup
        navigate('/setup', { replace: true });
        return;
      }

      const groupIds = memberships.map(m => m.group_id);

      // Fetch group details
      const { data: groupsData } = await supabase
        .from('groups')
        .select('id, name')
        .in('id', groupIds);

      if (!groupsData) {
        setLoading(false);
        return;
      }

      // Get member counts
      const groupInfos: GroupInfo[] = [];
      for (const g of groupsData) {
        const { count } = await supabase
          .from('group_members')
          .select('*', { count: 'exact', head: true })
          .eq('group_id', g.id);
        groupInfos.push({ id: g.id, name: g.name, member_count: count ?? 0 });
      }

      // If only one group, go directly to dashboard
      if (groupInfos.length === 1) {
        navigate(`/dashboard/${groupInfos[0].id}`, { replace: true });
        return;
      }

      setGroups(groupInfos);
      setLoading(false);
    };

    fetchGroups();
  }, [user, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-primary">
          <Film className="w-12 h-12" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-primary/5 blur-[120px]" />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="glass-card rounded-2xl p-8 w-full max-w-md mx-4 relative z-10"
      >
        <div className="space-y-6">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
              <Film className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-display font-bold">Your Clubs</h1>
            <p className="text-muted-foreground mt-2">Choose a club to enter</p>
          </div>

          <div className="space-y-3">
            {groups.map((g) => (
              <button
                key={g.id}
                onClick={() => navigate(`/dashboard/${g.id}`)}
                className="w-full flex items-center gap-4 rounded-xl p-4 border border-border bg-muted/10 hover:border-primary/50 hover:bg-primary/5 transition-all text-left"
              >
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Film className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{g.name}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Users className="w-3 h-3" /> {g.member_count} members
                  </p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground" />
              </button>
            ))}
          </div>

          <Button
            variant="outline"
            className="w-full"
            onClick={() => navigate('/setup')}
          >
            <Plus className="w-4 h-4 mr-2" /> Join or Create Another Club
          </Button>
        </div>
      </motion.div>
    </div>
  );
};

export default ClubSelect;
