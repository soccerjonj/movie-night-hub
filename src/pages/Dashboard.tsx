import { useAuth } from '@/hooks/useAuth';
import { useGroup } from '@/hooks/useGroup';
import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Film, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SeasonStatus from '@/components/dashboard/SeasonStatus';
import AdminPanel from '@/components/dashboard/AdminPanel';
import MoviePickPhase from '@/components/dashboard/MoviePickPhase';
import GuessingPhase from '@/components/dashboard/GuessingPhase';
import WatchingPhase from '@/components/dashboard/WatchingPhase';
import MemberList from '@/components/dashboard/MemberList';

const Dashboard = () => {
  const { user, signOut } = useAuth();
  const { group, season, moviePicks, members, profiles, loading, isAdmin, refetch, getProfile } = useGroup();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !group) {
      navigate('/setup');
    }
  }, [loading, group, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-primary">
          <Film className="w-12 h-12" />
        </div>
      </div>
    );
  }

  if (!group) return null;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="container max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Film className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold">{group.name}</h1>
              {season && (
                <p className="text-xs text-muted-foreground">Season {season.season_number}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground hidden sm:block">
              {getProfile(user!.id)?.display_name}
            </span>
            <Button variant="ghost" size="icon" onClick={() => { signOut(); navigate('/'); }}>
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container max-w-5xl mx-auto px-4 py-8 space-y-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          {/* Admin Panel */}
          {isAdmin && (
            <AdminPanel
              group={group}
              season={season}
              moviePicks={moviePicks}
              members={members}
              onUpdate={refetch}
            />
          )}

          {/* Season Status */}
          {season && <SeasonStatus season={season} moviePicks={moviePicks} getProfile={getProfile} />}

          {/* Phase-specific content */}
          {season?.status === 'picking' && (
            <MoviePickPhase season={season} moviePicks={moviePicks} members={members} onUpdate={refetch} />
          )}
          {season?.status === 'guessing' && (
            <GuessingPhase season={season} moviePicks={moviePicks} members={members} profiles={profiles} onUpdate={refetch} />
          )}
          {season?.status === 'watching' && (
            <WatchingPhase season={season} moviePicks={moviePicks} getProfile={getProfile} isAdmin={isAdmin} onUpdate={refetch} />
          )}

          {/* Members */}
          <MemberList members={members} profiles={profiles} group={group} isAdmin={isAdmin} />

          {/* No season yet */}
          {!season && !isAdmin && (
            <div className="glass-card rounded-2xl p-12 text-center">
              <Film className="w-16 h-16 text-primary/30 mx-auto mb-4" />
              <h2 className="text-xl font-display font-bold mb-2">No Season Yet</h2>
              <p className="text-muted-foreground">Waiting for your admin to start a new season.</p>
            </div>
          )}
        </motion.div>
      </main>
    </div>
  );
};

export default Dashboard;
