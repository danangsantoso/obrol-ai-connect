import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import ChangePassword from "@/pages/ChangePassword";
import { listenToBackButton, listenToNotifications, registerNativePush } from "./native";
import { ONBOARDED_KEY } from "./helpers";

const Welcome = lazy(() => import("./Welcome"));
const Login = lazy(() => import("./Login"));
const InboxScreen = lazy(() => import("./InboxScreen"));
const ChatScreen = lazy(() => import("./ChatScreen"));
const ContactsScreen = lazy(() => import("./ContactsScreen"));
const ContactScreen = lazy(() => import("./ContactScreen"));
const OrdersScreen = lazy(() => import("./OrdersScreen"));
const AccountScreen = lazy(() => import("./AccountScreen"));
const ProfileScreen = lazy(() => import("./ProfileScreen"));
const PasswordScreen = lazy(() => import("./PasswordScreen"));

function Spinner() {
  return (
    <div className="flex h-[100dvh] items-center justify-center bg-[#f4f6fb]">
      <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  const { signOut } = useAuth();
  return (
    <div className="flex h-[100dvh] flex-col items-center justify-center gap-3 bg-[#f4f6fb] p-8 text-center">
      <h1 className="text-xl font-extrabold">{title}</h1>
      <p className="text-sm text-slate-600">{body}</p>
      <button className="min-h-[44px] font-bold text-primary" onClick={() => signOut()}>
        Keluar
      </button>
    </div>
  );
}

const onboarded = () => {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === "1";
  } catch {
    return true;
  }
};

// Signed-in screens: registers the phone for notifications and opens the chat
// a tapped notification points at.
function SignedIn({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, isMaster, tenantSuspended } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!profile?.id) return;
    registerNativePush();
    return listenToNotifications(
      (path) => navigate(path),
      (title, body, path) => toast(title, { description: body, action: { label: "Buka", onClick: () => navigate(path) } }),
    );
  }, [profile?.id, navigate]);

  if (loading) return <Spinner />;
  if (!user) return <Navigate to={onboarded() ? "/m/masuk" : "/m/selamat-datang"} replace />;
  if (profile?.must_change_password) return <ChangePassword />;
  if (isMaster && !profile?.organization_id) return <Notice title="Akun Master Admin" body="Aplikasi HP ini untuk agen dan CS. Kelola platform dari Balas.id versi web." />;
  if (!profile?.organization_id) return <Notice title="Akun belum tergabung" body="Minta admin toko Anda menambahkan akun ini sebagai anggota tim." />;
  if (tenantSuspended) return <Notice title="Akun toko dinonaktifkan" body="Hubungi pengelola Balas.id untuk mengaktifkannya kembali." />;
  return <>{children}</>;
}

const ROOTS = ["/m/inbox", "/m/kontak", "/m/pesanan", "/m/akun", "/m/masuk", "/m/selamat-datang"];

export default function MobileApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  // "Add to Home Screen" from these screens installs the mobile app (iPhone).
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const previous = link?.getAttribute("href");
    link?.setAttribute("href", "/m.webmanifest");
    return () => {
      if (link && previous) link.setAttribute("href", previous);
    };
  }, []);

  // Android back button.
  useEffect(
    () => listenToBackButton(() => ROOTS.includes(window.location.pathname), () => navigate(-1)),
    [navigate],
  );

  const signedIn = (el: React.ReactNode) => <SignedIn>{el}</SignedIn>;
  const start = !onboarded() ? "/m/selamat-datang" : user ? "/m/inbox" : "/m/masuk";

  return (
    <Suspense fallback={<Spinner />}>
      <Routes location={location}>
        <Route index element={<Navigate to={start} replace />} />
        <Route path="selamat-datang" element={<Welcome />} />
        <Route path="masuk" element={<Login />} />
        <Route path="inbox" element={signedIn(<InboxScreen />)} />
        <Route path="chat/:conversationId" element={signedIn(<ChatScreen />)} />
        <Route path="kontak" element={signedIn(<ContactsScreen />)} />
        <Route path="kontak/:contactId" element={signedIn(<ContactScreen />)} />
        <Route path="pesanan" element={signedIn(<OrdersScreen />)} />
        <Route path="akun" element={signedIn(<AccountScreen />)} />
        <Route path="akun/profil" element={signedIn(<ProfileScreen />)} />
        <Route path="akun/kata-sandi" element={signedIn(<PasswordScreen />)} />
        <Route path="*" element={<Navigate to="/m" replace />} />
      </Routes>
    </Suspense>
  );
}
