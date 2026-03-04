import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Group } from '@/hooks/useGroup';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { UserPlus } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  group: Group;
  onAdded: () => void;
}

const AddPlaceholderDialog = ({ group, onAdded }: Props) => {
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [adding, setAdding] = useState(false);

  const getErrorMessage = (err: unknown) => {
    if (err instanceof Error) return err.message;
    if (typeof err === 'object' && err !== null && 'message' in err) {
      const maybeMessage = (err as { message?: unknown }).message;
      if (typeof maybeMessage === 'string' && maybeMessage.trim()) return maybeMessage;
    }
    return 'Failed to add placeholder';
  };

  const handleAdd = async () => {
    const name = displayName.trim();
    if (!name) {
      toast.error('Enter a display name');
      return;
    }

    setAdding(true);
    try {
      // Generate a random UUID for the placeholder user_id
      const placeholderUserId = crypto.randomUUID();

      // Create placeholder profile
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({
          user_id: placeholderUserId,
          display_name: name,
          is_placeholder: true,
        });
      if (profileError) throw profileError;

      // Add as group member
      const { error: memberError } = await supabase
        .from('group_members')
        .insert({
          group_id: group.id,
          user_id: placeholderUserId,
        });
      if (memberError) throw memberError;

      toast.success(`${name} added as member`);
      setDisplayName('');
      setOpen(false);
      onAdded();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <UserPlus className="w-4 h-4 mr-1" /> Add Member
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display">Add Member</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Add a member who hasn't joined yet. They can claim their account later.
        </p>
        <div className="space-y-3 mt-2">
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Display name"
            className="bg-muted/50"
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <Button variant="gold" className="w-full" onClick={handleAdd} disabled={adding}>
            {adding ? 'Adding...' : 'Add Member'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AddPlaceholderDialog;
