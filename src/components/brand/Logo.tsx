import { cn } from '@/lib/utils';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('h-8 w-8', className)} aria-hidden="true">
      <rect x="4" y="6" width="56" height="44" rx="12" className="fill-primary" />
      <path d="M16 50l-5 10l17-10z" className="fill-primary" />
      <circle cx="20" cy="28" r="4" fill="#fff" />
      <circle cx="32" cy="28" r="4" fill="#fff" />
      <circle cx="44" cy="28" r="4" fill="#fff" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <LogoMark />
      <span className="text-lg font-bold tracking-tight text-primary">Balas.id</span>
    </div>
  );
}
