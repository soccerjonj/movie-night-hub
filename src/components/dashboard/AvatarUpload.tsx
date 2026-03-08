import { useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Camera } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  currentAvatarUrl: string | null;
  displayName: string;
  onUploaded: () => void;
}

const AvatarUpload = ({ currentAvatarUrl, displayName, onUploaded }: Props) => {
  const { user } = useAuth();
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error('Image must be under 2MB');
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const filePath = `${user.id}/avatar.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      const avatarUrl = `${publicUrl}?t=${Date.now()}`;

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: avatarUrl })
        .eq('user_id', user.id);
      if (updateError) throw updateError;

      toast.success('Profile picture updated!');
      onUploaded();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to upload');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <button
      onClick={() => fileInputRef.current?.click()}
      disabled={uploading}
      className="relative group shrink-0"
    >
      <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center">
        {currentAvatarUrl ? (
          <img src={currentAvatarUrl} alt={displayName} className="w-full h-full object-cover" />
        ) : (
          <span className="text-xs sm:text-sm font-bold text-primary">
            {displayName?.charAt(0).toUpperCase() || '?'}
          </span>
        )}
      </div>
      <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
        <Camera className="w-3 h-3 sm:w-4 sm:h-4 text-white" />
      </div>
      {uploading && (
        <div className="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center">
          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleUpload}
        className="hidden"
      />
    </button>
  );
};

export default AvatarUpload;
