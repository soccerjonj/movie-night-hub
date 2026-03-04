import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

export interface Group {
  id: string;
  name: string;
  join_code: string;
  admin_user_id: string;
}

export interface Season {
  id: string;
  group_id: string;
  season_number: number;
  title: string | null;
  status: 'picking' | 'guessing' | 'watching' | 'completed';
  current_movie_index: number;
  next_call_date: string | null;
}

export interface MoviePick {
  id: string;
  season_id: string;
  user_id: string;
  tmdb_id: number | null;
  title: string;
  poster_url: string | null;
  year: string | null;
  overview: string | null;
  watch_order: number | null;
  revealed: boolean;
}

export interface Profile {
  id: string;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
}

export interface GroupMember {
  id: string;
  group_id: string;
  user_id: string;
  profile?: Profile;
}

export function useGroup() {
  const { user } = useAuth();
  const [group, setGroup] = useState<Group | null>(null);
  const [season, setSeason] = useState<Season | null>(null);
  const [moviePicks, setMoviePicks] = useState<MoviePick[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // Get user's group
      const { data: memberData } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', user.id)
        .limit(1);
      
      if (!memberData || memberData.length === 0) {
        setLoading(false);
        return;
      }

      const groupId = memberData[0].group_id;

      // Fetch group, members, profiles in parallel
      const [groupRes, membersRes, profilesRes] = await Promise.all([
        supabase.from('groups').select('*').eq('id', groupId).single(),
        supabase.from('group_members').select('*').eq('group_id', groupId),
        supabase.from('profiles').select('*'),
      ]);

      if (groupRes.data) {
        setGroup(groupRes.data as Group);
        setIsAdmin(groupRes.data.admin_user_id === user.id);
      }
      if (membersRes.data) setMembers(membersRes.data);
      if (profilesRes.data) setProfiles(profilesRes.data as Profile[]);

      // Get latest season
      const { data: seasonData } = await supabase
        .from('seasons')
        .select('*')
        .eq('group_id', groupId)
        .order('season_number', { ascending: false })
        .limit(1);

      if (seasonData && seasonData.length > 0) {
        const s = seasonData[0] as Season;
        setSeason(s);

        // Get movie picks for this season
        const { data: picks } = await supabase
          .from('movie_picks')
          .select('*')
          .eq('season_id', s.id)
          .order('watch_order', { ascending: true });
        if (picks) setMoviePicks(picks as MoviePick[]);
      }
    } catch (err) {
      console.error('Error fetching group data:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const getProfile = (userId: string) => profiles.find(p => p.user_id === userId);

  return { group, season, moviePicks, members, profiles, loading, isAdmin, refetch: fetchData, getProfile };
}
