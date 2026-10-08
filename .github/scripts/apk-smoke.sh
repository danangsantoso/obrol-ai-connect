#!/usr/bin/env bash
# Installs the APK on the running emulator, opens it, grants notifications
# and checks it is still running a while later without a crash in the log.
set -euo pipefail
apk="$1"
pkg=id.balas.agen
adb install -r "$apk"
adb shell pm grant "$pkg" android.permission.POST_NOTIFICATIONS || true
adb logcat -c
adb shell monkey -p "$pkg" -c android.intent.category.LAUNCHER 1 >/dev/null
sleep 30
# Open it a second time, as a returning user would.
adb shell am force-stop "$pkg"
adb shell monkey -p "$pkg" -c android.intent.category.LAUNCHER 1 >/dev/null
sleep 20
adb logcat -d > logcat.txt || true
if grep -E "FATAL EXCEPTION|AndroidRuntime: Process: $pkg" logcat.txt; then
  echo "::error::Aplikasi berhenti sendiri (crash) saat dibuka"
  grep -A30 "FATAL EXCEPTION" logcat.txt | head -60
  exit 1
fi
if ! adb shell pidof "$pkg" >/dev/null; then
  echo "::error::Aplikasi tidak berjalan setelah dibuka"
  tail -100 logcat.txt
  exit 1
fi
echo "Aplikasi terbuka dan tetap berjalan."

# Debug builds: check the flag the web code uses to decide on push.
pid=$(adb shell pidof "$pkg" | tr -d '\r')
if adb forward tcp:9222 "localabstract:webview_devtools_remote_$pid" && curl -sf http://127.0.0.1:9222/json >/dev/null; then
  expect=no
  [ -f android/app/google-services.json ] && expect=yes
  node .github/scripts/webview-check.mjs 9222 "$expect"
else
  echo "WebView tidak bisa diperiksa (build rilis), dilewati."
fi
