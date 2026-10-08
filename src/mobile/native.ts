// The Android app's native side (Capacitor): push notifications through
// Firebase, the hardware back button, and opening the chat a notification
// points at. In a browser these fall back to Web Push or do nothing.
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { PushNotifications } from "@capacitor/push-notifications";
import { supabase } from "@/integrations/supabase/client";

export const isNativeApp = () => Capacitor.isNativePlatform();

// The APK was built with Firebase (google-services.json). Without it the push
// plugin crashes the app on register(), so it is never called then.
export const nativePushAvailable = () => isNativeApp() && /\bBalasFCM\b/.test(navigator.userAgent);

const TOKEN_KEY = "balas.m.fcm";

// Notification links use the web app's paths; the app opens its own screen.
export function appPath(url: string | undefined | null) {
  const chat = /^\/inbox\/([0-9a-f-]{36})/.exec(url ?? "");
  return chat ? `/m/chat/${chat[1]}` : "/m/inbox";
}

export type PermissionState = "granted" | "denied" | "prompt" | "unsupported";

export async function notificationPermission(): Promise<PermissionState> {
  if (isNativeApp()) {
    const { receive } = await PushNotifications.checkPermissions();
    return receive === "granted" ? "granted" : receive === "denied" ? "denied" : "prompt";
  }
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission === "default" ? "prompt" : Notification.permission;
}

export async function askNotificationPermission(): Promise<PermissionState> {
  if (isNativeApp()) {
    await PushNotifications.createChannel({
      id: "chat",
      name: "Chat pelanggan",
      description: "Pesan baru, chat untuk Anda, dan AI butuh bantuan",
      importance: 5,
      visibility: 1,
      vibration: true,
    }).catch(() => undefined);
    const { receive } = await PushNotifications.requestPermissions();
    return receive === "granted" ? "granted" : "denied";
  }
  if (typeof Notification === "undefined") return "unsupported";
  const result = await Notification.requestPermission();
  return result === "default" ? "prompt" : result;
}

// Registers this phone for the signed-in person (needs permission first).
export async function registerNativePush(): Promise<boolean> {
  if (!nativePushAvailable() || (await notificationPermission()) !== "granted") return false;
  const handles: Promise<{ remove: () => Promise<void> }>[] = [];
  const token = await new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), 15_000);
    handles.push(PushNotifications.addListener("registration", ({ value }) => {
      clearTimeout(timer);
      resolve(value);
    }));
    handles.push(PushNotifications.addListener("registrationError", (err) => {
      clearTimeout(timer);
      console.error("push registration failed", err);
      resolve(null);
    }));
    PushNotifications.register().catch(() => resolve(null));
  });
  handles.forEach((h) => h.then((x) => x.remove()));
  if (!token) return false;
  const { error } = await supabase.rpc("register_push_device", { p_token: token, p_user_agent: `Balas.id Android · ${navigator.userAgent}` });
  if (error) {
    console.error("could not save the device", error);
    return false;
  }
  localStorage.setItem(TOKEN_KEY, token);
  return true;
}

// Before signing out: this phone stops receiving the person's notifications.
export async function unregisterNativePush() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return;
  await supabase.from("push_subscriptions").delete().eq("endpoint", token);
  localStorage.removeItem(TOKEN_KEY);
}

// Tapping a notification opens its chat; a notification arriving while the
// app is open shows inside the app instead.
export function listenToNotifications(
  open: (path: string) => void,
  foreground: (title: string, body: string, path: string) => void,
) {
  if (!isNativeApp()) return () => undefined;
  const handles = [
    PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      open(appPath(action.notification.data?.url));
    }),
    PushNotifications.addListener("pushNotificationReceived", (n) => {
      foreground(n.title ?? "Balas.id", n.body ?? "", appPath(n.data?.url));
    }),
  ];
  return () => handles.forEach((h) => h.then((x) => x.remove()));
}

// Android back button: back through the app's screens, then leave the app.
export function listenToBackButton(atRoot: () => boolean, back: () => void) {
  if (!isNativeApp()) return () => undefined;
  const handle = App.addListener("backButton", () => {
    if (atRoot()) App.exitApp();
    else back();
  });
  return () => {
    handle.then((h) => h.remove());
  };
}
