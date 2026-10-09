import { Share } from "lucide-react";

// iPhone has no APK: Balas.id Agen is installed from Safari to the home
// screen, which is also what lets iPhone show notifications.
export const isIphoneBrowser = () =>
  typeof navigator !== "undefined" &&
  /iPhone|iPad|iPod/.test(navigator.userAgent) &&
  !(window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone);

export function IosInstallHint() {
  if (!isIphoneBrowser()) return null;
  return (
    <div role="note" className="space-y-1.5 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-[13px] leading-relaxed text-blue-950">
      <p className="font-bold">Pasang di iPhone (tanpa App Store)</p>
      <ol className="list-decimal space-y-0.5 pl-4">
        <li>Buka halaman ini di <b>Safari</b>.</li>
        <li>
          Ketuk tombol Bagikan <Share className="inline h-3.5 w-3.5 align-[-2px]" /> lalu <b>Tambah ke Layar Utama</b>.
        </li>
        <li>Buka <b>Balas.id</b> dari layar utama, masuk, lalu aktifkan notifikasi di menu Akun.</li>
      </ol>
    </div>
  );
}
