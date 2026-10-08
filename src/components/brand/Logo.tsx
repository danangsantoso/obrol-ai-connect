import { useId } from "react";
import { cn } from "@/lib/utils";

// Balas.id robot-in-a-chat-bubble mark, drawn as vectors so it stays sharp at any size.
// The full logo (mark + "balas.id" wordmark) is /brand/balas-logo.svg; PNG exports live in /public/brand.
export function LogoMark({ className }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  const bg = `balas-bg-${id}`;
  const bl = `balas-bl-${id}`;
  return (
    <svg
      viewBox="-44 22 614 614"
      className={cn("h-8 w-8", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={bg}
          x1="60"
          y1="40"
          x2="470"
          y2="600"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#22A6EE" />
          <stop offset="1" stopColor="#0665D8" />
        </linearGradient>
        <linearGradient
          id={bl}
          x1="0"
          y1="395"
          x2="0"
          y2="545"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#48B4F2" />
          <stop offset="1" stopColor="#1872E2" />
        </linearGradient>
      </defs>
      <g fill={`url(#${bg})`}>
        <circle cx="289" cy="54" r="27" />
        <rect x="278" y="70" width="22" height="56" />
        <rect x="79" y="224" width="70" height="80" rx="18" />
        <rect x="430" y="212" width="69" height="120" rx="20" />
        <path d="M258 118H320A140 140 0 0 1 460 258V320A70 70 0 0 1 390 390H188A70 70 0 0 1 118 320V258A140 140 0 0 1 258 118Z" />
        <path d="M21 330Q21 300 51 300H150V362H440Q489 362 489 411V480Q489 541 428 541H142L46 614Q21 633 21 602Z" />
      </g>
      <rect x="159" y="174" width="261" height="190" rx="52" fill="#fff" />
      <path
        d="M110 545V455Q110 395 170 395H412Q470 395 470 453V483Q470 541 412 541H142Z"
        fill={`url(#${bl})`}
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <img
      src="/brand/balas-logo.svg"
      alt="Balas.id"
      className={cn("h-9 w-auto", className)}
    />
  );
}
