import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Profile } from '@/hooks/useGroup';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Trophy } from 'lucide-react';
import PastRankingsDialog from './PastRankingsDialog';

interface Props {
  groupId: string;
  profiles: Profile[];
  onUpdate: () => void;
}

const UnrankedSeasonsReminder = ({ groupId, profiles, onUpdate }: Props) => {
  const { user } = useAuth();
  const [unrankedCount, setUnrankedCount] = useState(0);
  const [showReminder, setShowReminder] = useState(false);
  const [showRankings, setShowRankings] = useState(false);

  useEffect(() => {
    if (!user || !groupId) return;

    const checkUnranked = async () => {
      const { data: seasons } = await supabase
        .from('seasons')
        .select('id')
        .eq('group_id', groupId)
        .in('status', ['completed', 'reviewing']);

      if (!seasons || seasons.length === 0) return;

      const { data: existingRankings } = await supabase
        .from('movie_rankings')
        .select('season_id')
        .eq('user_id', user.id)
        .in('season_id', seasons.map(s => s.id));

      const rankedIds = new Set((existingRankings || []).map(r => r.season_id));
      const count = seasons.filter(s => !rankedIds.has(s.id)).length;

      if (count > 0) {
        setUnrankedCount(count);
        setShowReminder(true);
      }
    };

    checkUnranked();
  }, [user, groupId]);

  const handleRankNow = () => {
    setShowReminder(false);
    setShowRankings(true);
  };

  return (
    <>
      <Dialog open={showReminder} onOpenChange={setShowReminder}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Trophy className="w-5 h-5 text-primary" />
              Rankings Missing
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            You have <span className="font-semibold text-foreground">{unrankedCount}</span> unranked {unrankedCount === 1 ? 'season' : 'seasons'}. Submit your rankings so the club results are complete!
          </p>
          <div className="flex gap-2 mt-2">
            <Button variant="outline" className="flex-1" onClick={() => setShowReminder(false)}>
              Later
            </Button>
            <Button variant="gold" className="flex-1" onClick={handleRankNow}>
              Rank Now
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <PastRankingsDialog
        open={showRankings}
        onOpenChange={setShowRankings}
        groupId={groupId}
        profiles={profiles}
        onUpdate={onUpdate}
      />
    </>
  );
};

export default UnrankedSeasonsReminder;
