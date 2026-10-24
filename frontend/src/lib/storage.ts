import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { createJSONStorage, type StateStorage } from 'zustand/middleware';

const isWeb = Platform.OS === 'web';

function webStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null; // private mode / blocked storage
  }
}

/** Small secrets (auth tokens): Keychain/Keystore on devices, localStorage on web. */
export const secureStore = {
  async get(key: string): Promise<string | null> {
    try {
      if (isWeb) return webStorage()?.getItem(key) ?? null;
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    try {
      if (isWeb) webStorage()?.setItem(key, value);
      else await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
    } catch {
      // Storage full/blocked: the session simply won't survive a restart
    }
  },
  async remove(key: string): Promise<void> {
    try {
      if (isWeb) webStorage()?.removeItem(key);
      else await SecureStore.deleteItemAsync(key);
    } catch {
      /* ignore */
    }
  },
};

const safeAsyncStorage: StateStorage = {
  getItem: async (name) => {
    try {
      return await AsyncStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: async (name, value) => {
    try {
      await AsyncStorage.setItem(name, value);
    } catch {
      /* quota exceeded etc. — keep running from memory */
    }
  },
  removeItem: async (name) => {
    try {
      await AsyncStorage.removeItem(name);
    } catch {
      /* ignore */
    }
  },
};

/** Persistent storage for cached business data and the offline order queue. */
export const persistStorage = createJSONStorage(() => safeAsyncStorage);
