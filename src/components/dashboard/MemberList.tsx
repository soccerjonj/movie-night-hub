import { Group, GroupMember, Profile } from '@/hooks/useGroup';
import { Users, Crown } from 'lucide-react';

interface Props {
  members: GroupMember[];
  profiles: Profile[];
  group: Group;
  isAdmin: boolean;
}

const MemberList = ({ members, profiles, group, isAdmin }: Props) => {
  const getProfile = (userId: string) => profiles.find(p => p.user_id === userId);

  return (
    <div className="glass-card rounded-2xl p-6 mt-6">
      <div className="flex items-center gap-2 mb-4">
        <Users className="w-5 h-5 text-primary" />
        <h2 className="font-display text-lg font-bold">Members</h2>
        <span className="text-xs text-muted-foreground ml-auto">{members.length} members</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {members.map((member) => {
          const profile = getProfile(member.user_id);
          const isGroupAdmin = member.user_id === group.admin_user_id;
          return (
            <div
              key={member.id}
              className="flex items-center gap-2 bg-muted/20 rounded-xl p-3"
            >
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                {profile?.display_name?.charAt(0).toUpperCase() || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{profile?.display_name || 'Unknown'}</p>
                {isGroupAdmin && (
                  <span className="flex items-center gap-1 text-xs text-primary">
                    <Crown className="w-3 h-3" /> Admin
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MemberList;
