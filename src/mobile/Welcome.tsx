import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BellRing, Bot, Hand, Inbox } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { askNotificationPermission } from "./native";
import { ONBOARDED_KEY } from "./helpers";


const STEPS = [
  {
    title: "Semua chat pelanggan di satu HP",
    body: "WhatsApp, Instagram, Messenger, dan Telegram toko masuk ke satu Inbox. Balas dari mana saja, kapan saja.",
    tint: "bg-blue-50",
  },
  {
    title: "AI membantu, Anda yang memutuskan",
    body: "AI menjawab pelanggan lebih dulu, 24 jam. Saat perlu, ketuk Ambil alih dan chat langsung jadi milik Anda.",
    tint: "bg-indigo-50",
  },
  {
    title: "Jangan sampai ada chat terlewat",
    body: "Izinkan notifikasi agar HP berbunyi saat ada chat baru untuk Anda atau saat AI butuh bantuan.",
    tint: "bg-orange-50",
  },
];

function Illustration({ step }: { step: number }) {
  if (step === 0) {
    return (
      <div className="flex w-56 flex-col gap-3">
        {[
          ["WA", "#15803d", ""],
          ["IG", "#be185d", "ml-6"],
          ["TG", "#0369a1", ""],
        ].map(([label, color, extra]) => (
          <div key={label} className={cn("flex items-center gap-2.5 rounded-2xl bg-white p-3 shadow-md shadow-slate-900/5", extra)}>
            <span style={{ background: color }} className="flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-extrabold text-white">
              {label}
            </span>
            <span className="h-2.5 flex-1 rounded-full bg-slate-200" />
          </div>
        ))}
        <Inbox className="mx-auto mt-1 h-7 w-7 text-primary" aria-hidden />
      </div>
    );
  }
  if (step === 1) {
    return (
      <div className="flex w-60 flex-col gap-3 text-[13px]">
        <div className="self-start rounded-2xl rounded-tl-sm bg-white px-3 py-2 shadow-md shadow-slate-900/5">Kak, stok masih ada?</div>
        <div className="self-end rounded-2xl rounded-tr-sm bg-primary px-3 py-2 leading-snug text-white">
          <b className="flex items-center gap-1 text-[11px] text-blue-100">
            <Bot className="h-3 w-3" /> AI
          </b>
          Masih ada kak, mau dikirim ke mana?
        </div>
        <div className="flex items-center gap-2 self-center rounded-xl bg-white px-3.5 py-2 font-bold text-blue-900 shadow-md shadow-slate-900/5">
          <Hand className="h-4 w-4 text-primary" /> Ambil alih kapan saja
        </div>
      </div>
    );
  }
  return (
    <div className="flex w-60 flex-col items-center gap-4">
      <span className="flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-md shadow-slate-900/5">
        <BellRing className="h-10 w-10 text-orange-700" />
      </span>
      <div className="flex w-full gap-2.5 rounded-2xl bg-white p-3 text-xs shadow-md shadow-slate-900/5">
        <span className="h-8 w-8 shrink-0 rounded-lg bg-primary" />
        <span className="flex flex-col gap-0.5">
          <b>Chat untuk Anda</b>
          <span className="text-slate-600">Kak, ongkir ke Bandung berapa?</span>
        </span>
      </div>
    </div>
  );
}

export default function Welcome() {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const { user } = useAuth();
  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  const finish = async (ask: boolean) => {
    if (ask) await askNotificationPermission().catch(() => undefined);
    try {
      localStorage.setItem(ONBOARDED_KEY, "1");
    } catch {
      // private mode: show it again next time
    }
    navigate(user ? "/m/inbox" : "/m/masuk", { replace: true });
  };

  return (
    <div className="flex h-[100dvh] flex-col bg-white pt-[env(safe-area-inset-top)] text-slate-900">
      <div className="flex min-h-[60px] justify-end px-3 pt-4">
        {!last && (
          <button onClick={() => finish(false)} className="min-h-[44px] px-3 text-[15px] font-bold text-slate-600">
            Lewati
          </button>
        )}
      </div>
      <div className="flex flex-1 flex-col items-center gap-7 px-7 pt-2">
        <div className={cn("flex aspect-square w-full max-w-[300px] items-center justify-center rounded-[40px]", s.tint)}>
          <Illustration step={step} />
        </div>
        <div className="space-y-2.5 text-center">
          <h1 className="text-[26px] font-extrabold leading-tight">{s.title}</h1>
          <p className="text-[15px] leading-relaxed text-slate-600">{s.body}</p>
        </div>
        <div aria-label={`Langkah ${step + 1} dari ${STEPS.length}`} className="flex gap-2">
          {STEPS.map((_, i) => (
            <span key={i} className={cn("h-2 rounded-full transition-all", i === step ? "w-7 bg-primary" : "w-2 bg-slate-300")} />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2 px-6 pb-[max(env(safe-area-inset-bottom),36px)]">
        {last ? (
          <>
            <button onClick={() => finish(true)} className="h-[54px] rounded-2xl bg-primary text-base font-bold text-white">
              Izinkan notifikasi
            </button>
            <button onClick={() => finish(false)} className="min-h-[48px] text-[15px] font-bold text-slate-600">
              Nanti saja
            </button>
          </>
        ) : (
          <button onClick={() => setStep(step + 1)} className="h-[54px] rounded-2xl bg-primary text-base font-bold text-white">
            Lanjut
          </button>
        )}
      </div>
    </div>
  );
}
