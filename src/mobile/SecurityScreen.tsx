import { MfaSettings } from "@/components/auth/Mfa";
import { Screen } from "./ui";

export default function SecurityScreen() {
  return (
    <Screen back="/m/akun" title="Verifikasi 2 langkah">
      <div className="px-5 py-6">
        <div className="rounded-2xl bg-white p-4">
          <MfaSettings />
        </div>
      </div>
    </Screen>
  );
}
