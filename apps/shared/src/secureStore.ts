import * as SecureStore from "expo-secure-store";

/** Phones: sign-in tokens live in the iOS Keychain / Android Keystore, only while the device is unlocked. */
export const secureStore = {
  get: (k: string) => SecureStore.getItemAsync(k),
  set: (k: string, v: string) => SecureStore.setItemAsync(k, v, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  remove: (k: string) => SecureStore.deleteItemAsync(k),
};
