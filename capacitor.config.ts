import type { CapacitorConfig } from "@capacitor/cli";

// The agents' Android app. It opens the Balas.id web app's mobile screens
// (/m) from the server set in BALAS_APP_URL when the APK is built, so every
// web deploy updates the app without a new APK. mobile/www only holds the
// page shown when the phone is offline.
const appUrl = process.env.BALAS_APP_URL?.replace(/\/+$/, "");

const config: CapacitorConfig = {
  appId: "id.balas.agen",
  appName: "Balas.id",
  webDir: "mobile/www",
  server: appUrl
    ? {
        url: `${appUrl}/m`,
        errorPath: "index.html",
        allowNavigation: [new URL(appUrl).host],
      }
    : undefined,
  android: {
    allowMixedContent: false,
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
