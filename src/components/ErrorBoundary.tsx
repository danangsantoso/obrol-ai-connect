import { Component, type ReactNode } from "react";
import { reportClientError } from "@/lib/errorReporter";

// A crash in one screen shows a way out instead of a blank page, and is reported.
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    reportClientError(error, info.componentStack ?? undefined);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <h1 className="text-xl font-bold">Terjadi kesalahan</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Halaman ini gagal ditampilkan. Masalahnya sudah dilaporkan otomatis. Coba muat ulang.
        </p>
        <button
          onClick={() => location.reload()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          Muat ulang
        </button>
      </div>
    );
  }
}
