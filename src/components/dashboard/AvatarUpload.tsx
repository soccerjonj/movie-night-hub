import { useState, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Camera, Crop } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import ReactCrop, { type Crop as CropType, centerCrop, makeAspectCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { validateImageFile, getSafeErrorMessage } from '@/lib/security';

interface Props {
  currentAvatarUrl: string | null;
  displayName: string;
  onUploaded: () => void;
}

function centerAspectCrop(mediaWidth: number, mediaHeight: number) {
  return centerCrop(
    makeAspectCrop({ unit: '%', width: 90 }, 1, mediaWidth, mediaHeight),
    mediaWidth,
    mediaHeight
  );
}

const AvatarUpload = ({ currentAvatarUrl, displayName, onUploaded }: Props) => {
  const { user } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [cropDialogOpen, setCropDialogOpen] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState<CropType>();
  const imgRef = useRef<HTMLImageElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    const validation = validateImageFile(file);
    if (!validation.valid) {
      toast.error(validation.error);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImageSrc(reader.result as string);
      setCropDialogOpen(true);
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    setCrop(centerAspectCrop(naturalWidth, naturalHeight));
  }, []);

  const handleCropCurrentPhoto = () => {
    if (!currentAvatarUrl) return;
    // Strip cache-busting param for fetch
    const url = currentAvatarUrl.split('?')[0];
    setImageSrc(url + '?t=' + Date.now());
    setCropDialogOpen(true);
  };

  const getCroppedBlob = (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const image = imgRef.current;
      if (!image || !crop) { resolve(null); return; }

      const canvas = document.createElement('canvas');
      const scaleX = image.naturalWidth / image.width;
      const scaleY = image.naturalHeight / image.height;

      const pixelCrop = {
        x: (crop.unit === '%' ? (crop.x / 100) * image.width : crop.x) * scaleX,
        y: (crop.unit === '%' ? (crop.y / 100) * image.height : crop.y) * scaleY,
        width: (crop.unit === '%' ? (crop.width / 100) * image.width : crop.width) * scaleX,
        height: (crop.unit === '%' ? (crop.height / 100) * image.height : crop.height) * scaleY,
      };

      const size = Math.min(pixelCrop.width, pixelCrop.height, 512);
      canvas.width = size;
      canvas.height = size;

      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(null); return; }

      ctx.drawImage(
        image,
        pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height,
        0, 0, size, size
      );

      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.9);
    });
  };

  const handleSaveCrop = async () => {
    if (!user) return;
    setUploading(true);
    try {
      const blob = await getCroppedBlob();
      if (!blob) throw new Error('Failed to crop image');

      const filePath = `${user.id}/avatar.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, blob, { upsert: true, contentType: 'image/jpeg' });
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
      setCropDialogOpen(false);
      setImageSrc(null);
    } catch (err: unknown) {
      toast.error(getSafeErrorMessage(err, 'Failed to upload'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <div className="relative group shrink-0">
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
        </button>
        {currentAvatarUrl && (
          <button
            onClick={handleCropCurrentPhoto}
            className="absolute -bottom-1 -right-1 w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-primary flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            title="Crop current photo"
          >
            <Crop className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-primary-foreground" />
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={onFileSelected}
          className="hidden"
        />
      </div>

      <Dialog open={cropDialogOpen} onOpenChange={(open) => { if (!uploading) { setCropDialogOpen(open); if (!open) setImageSrc(null); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Crop Profile Photo</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center max-h-[60vh] overflow-auto">
            {imageSrc && (
              <ReactCrop
                crop={crop}
                onChange={(c) => setCrop(c)}
                aspect={1}
                circularCrop
              >
                <img
                  ref={imgRef}
                  src={imageSrc}
                  alt="Crop preview"
                  onLoad={onImageLoad}
                  crossOrigin="anonymous"
                  className="max-h-[55vh] object-contain"
                />
              </ReactCrop>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setCropDialogOpen(false); setImageSrc(null); }} disabled={uploading}>
              Cancel
            </Button>
            <Button onClick={handleSaveCrop} disabled={uploading}>
              {uploading ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default AvatarUpload;
