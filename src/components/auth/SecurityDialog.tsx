import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MfaSettings } from "./Mfa";

export function SecurityDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Verifikasi 2 langkah</DialogTitle>
          <DialogDescription>Lindungi akun Anda dengan kode dari HP setiap kali masuk.</DialogDescription>
        </DialogHeader>
        {open && <MfaSettings />}
      </DialogContent>
    </Dialog>
  );
}
