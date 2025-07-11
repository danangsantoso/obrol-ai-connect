import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function Contacts() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Kontak & Label</h1>
          <p className="text-muted-foreground">Kelola database pelanggan dan sistem labeling otomatis</p>
        </div>
        <Button>Tambah Kontak</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Coming Soon</CardTitle>
          <CardDescription>
            Fitur manajemen kontak dan labeling sedang dalam pengembangan
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <span className="text-2xl">📋</span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Fitur Kontak & Label</h3>
            <p className="text-muted-foreground text-center max-w-md">
              Akan segera tersedia fitur untuk mengelola kontak pelanggan, 
              sistem labeling otomatis, dan import data dari file Excel.
            </p>
            <Badge variant="outline" className="mt-4">
              Dalam Pengembangan
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}