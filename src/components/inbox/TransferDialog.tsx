import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { errorMessage } from '@/lib/api';
import { toast } from 'sonner';
import type { Member, Team } from './types';
import { memberName } from './types';

const QUEUE = '__queue__';
const KEEP_TEAM = '__keep__';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  currentAssigneeId: string | null;
  members: Member[];
  teams: Team[];
  onDone: () => void;
}

export function TransferDialog({ open, onOpenChange, conversationId, currentAssigneeId, members, teams, onDone }: Props) {
  const [assignee, setAssignee] = useState<string>(QUEUE);
  const [team, setTeam] = useState<string>(KEEP_TEAM);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const candidates = members.filter((m) => m.is_active && m.id !== currentAssigneeId);

  const submit = async () => {
    setSaving(true);
    const { error } = await supabase.rpc('assign_conversation', {
      conv_id: conversationId,
      to_assignee: assignee === QUEUE ? null : assignee,
      to_team: team === KEEP_TEAM ? undefined : team,
      note: note || undefined,
    });
    setSaving(false);
    if (error) {
      toast.error(errorMessage(error));
      return;
    }
    toast.success('Percakapan dipindahkan');
    setNote('');
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pindahkan percakapan</DialogTitle>
          <DialogDescription>Riwayat chat dan catatan ikut pindah ke penerima.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Ke agen</Label>
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={QUEUE}>Kembalikan ke antrean</SelectItem>
                {candidates.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {memberName(m)} {m.status === 'online' ? '· online' : m.status === 'away' ? '· away' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {teams.length > 0 && (
            <div className="space-y-2">
              <Label>Tim / divisi</Label>
              <Select value={team} onValueChange={setTeam}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={KEEP_TEAM}>Tidak diubah</SelectItem>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label>Catatan untuk penerima (opsional)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Pindahkan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
