import { Copy, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

// How the team installs Balas.id Agen on their phones.
export function MobileAppCard() {
  const url = `${window.location.origin}/m`;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="h-5 w-5" /> Aplikasi HP untuk tim
        </CardTitle>
        <CardDescription>Agen bisa membalas chat dari HP. Bagikan petunjuk ini ke tim.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm md:grid-cols-2">
        <div className="space-y-1">
          <p className="font-semibold">Android</p>
          <p className="text-muted-foreground">Pasang file APK Balas.id Agen yang Anda bagikan (unduh dari halaman Releases GitHub), lalu masuk dengan akun masing-masing.</p>
        </div>
        <div className="space-y-1">
          <p className="font-semibold">iPhone</p>
          <p className="text-muted-foreground">
            Buka alamat di bawah di <b>Safari</b>, ketuk Bagikan → <b>Tambah ke Layar Utama</b>, lalu buka dari layar utama dan aktifkan notifikasi di menu Akun.
          </p>
        </div>
        <div className="flex items-center gap-2 md:col-span-2">
          <code className="flex-1 truncate rounded-md bg-muted px-3 py-2">{url}</code>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigator.clipboard.writeText(url).then(() => toast.success("Alamat disalin"))}
          >
            <Copy className="mr-1 h-4 w-4" /> Salin
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
