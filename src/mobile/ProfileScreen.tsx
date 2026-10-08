import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Camera, ChevronRight, ImageIcon, KeyRound, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/api";
import { Avatar, Screen } from "./ui";
import { Sheet, SheetButton } from "./ChatScreen";

// Square-crops and shrinks a photo to 512 px JPEG before upload.
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(512, side);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Foto tidak bisa diproses"))), "image/jpeg", 0.85));
}

export default function ProfileScreen() {
  const { profile, refreshProfile } = useAuth();
  const me = profile!;
  const navigate = useNavigate();
  const [name, setName] = useState(me.full_name ?? "");
  const [photo, setPhoto] = useState<string | null>(me.avatar_url);
  const [sheet, setSheet] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);

  const setAvatar = async (url: string | null) => {
    const { error } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", me.id);
    if (error) throw error;
    setPhoto(url);
    await refreshProfile();
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const blob = await shrink(file);
      const path = `${me.id}/${Date.now()}.jpg`;
      const { error } = await supabase.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg" });
      if (error) throw error;
      const old = photo?.split("/avatars/")[1];
      await setAvatar(supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl);
      if (old) await supabase.storage.from("avatars").remove([decodeURIComponent(old)]);
      toast.success("Foto profil diganti");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = async () => {
    setSheet(false);
    try {
      const old = photo?.split("/avatars/")[1];
      await setAvatar(null);
      if (old) await supabase.storage.from("avatars").remove([decodeURIComponent(old)]);
      toast.success("Foto profil dihapus");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const save = async () => {
    if (!name.trim()) return toast.error("Nama tidak boleh kosong");
    setSaving(true);
    const { error } = await supabase.from("profiles").update({ full_name: name.trim() }).eq("id", me.id);
    setSaving(false);
    if (error) return toast.error(errorMessage(error));
    await refreshProfile();
    toast.success("Profil disimpan");
    navigate("/m/akun");
  };

  const pickFrom = (input: React.RefObject<HTMLInputElement>) => {
    setSheet(false);
    input.current?.click();
  };

  return (
    <Screen
      back="/m/akun"
      title="Ubah profil"
      footer={
        <div className="border-t border-slate-200 bg-white px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-3">
          <button onClick={save} disabled={saving} className="flex h-[54px] w-full items-center justify-center rounded-2xl bg-primary text-base font-bold text-white">
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : "Simpan"}
          </button>
        </div>
      }
    >
      <div className="space-y-5 px-5 py-6">
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <Avatar name={name || me.email} url={photo} size={112} seed={me.id} />
            {uploading && (
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-slate-900/40">
                <Loader2 className="h-8 w-8 animate-spin text-white" />
              </span>
            )}
            <button
              onClick={() => setSheet(true)}
              aria-label="Ganti foto profil"
              className="absolute bottom-0 right-0 flex h-11 w-11 items-center justify-center rounded-full border-[3px] border-[#f4f6fb] bg-primary"
            >
              <Camera className="h-5 w-5 text-white" />
            </button>
          </div>
          <button onClick={() => setSheet(true)} className="min-h-[40px] text-sm font-bold text-primary">
            Ganti foto
          </button>
          <p className="text-center text-xs text-slate-600">Foto tampil di aplikasi Balas.id untuk HP.</p>
        </div>
        <input ref={camera} type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
        <input ref={gallery} type="file" accept="image/*" className="hidden" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />

        <div className="space-y-2">
          <label htmlFor="m-name" className="text-sm font-semibold">
            Nama lengkap
          </label>
          <input
            id="m-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-[52px] w-full rounded-2xl border border-slate-300 bg-white px-4 text-base outline-none focus:border-primary"
          />
          <p className="text-xs text-slate-600">Nama depan dipakai di sapaan follow-up ({"{agen}"}).</p>
        </div>
        <div className="space-y-2">
          <label htmlFor="m-email-ro" className="text-sm font-semibold">
            Email
          </label>
          <input id="m-email-ro" value={me.email} readOnly className="h-[52px] w-full rounded-2xl border border-slate-200 bg-slate-100 px-4 text-base text-slate-600" />
          <p className="text-xs text-slate-600">Email hanya bisa diubah oleh admin.</p>
        </div>
        <Link to="/m/akun/kata-sandi" className="flex min-h-[52px] items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4">
          <KeyRound className="h-5 w-5 text-slate-700" />
          <span className="flex-1 text-[15px] font-semibold">Ganti kata sandi</span>
          <ChevronRight className="h-5 w-5 text-slate-400" />
        </Link>
      </div>

      {sheet && (
        <Sheet title="Foto profil" onClose={() => setSheet(false)}>
          <SheetButton onClick={() => pickFrom(camera)}>
            <Camera className="mr-3.5 h-[22px] w-[22px] text-primary" /> Ambil foto dengan kamera
          </SheetButton>
          <SheetButton onClick={() => pickFrom(gallery)}>
            <ImageIcon className="mr-3.5 h-[22px] w-[22px] text-primary" /> Pilih dari galeri
          </SheetButton>
          {photo && (
            <SheetButton onClick={removePhoto} className="text-red-700">
              <Trash2 className="mr-3.5 h-[22px] w-[22px]" /> Hapus foto
            </SheetButton>
          )}
        </Sheet>
      )}
    </Screen>
  );
}
