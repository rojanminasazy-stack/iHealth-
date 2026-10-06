import React, { useState } from "react";
import * as Updates from "expo-updates";
import { Button, Notice, Screen, Small } from "@ihealthe/shared";
import { auth } from "../lib/session";

export default function Account() {
  const [busy, setBusy] = useState(false);
  return (
    <Screen>
      <Small>Signing out ends your session on every device.</Small>
      <Button
        title="Sign out everywhere"
        variant="danger"
        loading={busy}
        onPress={async () => {
          setBusy(true);
          await auth.signOut();
          await Updates.reloadAsync().catch(() => setBusy(false));
        }}
      />
      <Notice>Need help with your account or payouts? Email providers@ihealthe.net.</Notice>
    </Screen>
  );
}
