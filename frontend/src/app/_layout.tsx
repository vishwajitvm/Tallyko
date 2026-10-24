import React, { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold } from '@expo-google-fonts/inter';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import { useAuth } from '@/store/auth';
import { ToastHost, DialogHost } from '@/components/ui';
import { ErrorBoundary } from '@/components/ErrorBoundary';

void SplashScreen.preventAutoHideAsync().catch(() => {});

function Navigator() {
  const { colors, dark } = useTheme();
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.body.style.backgroundColor = colors.background;
    }
  }, [colors.background]);
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
        <Stack.Screen name="store/[tenantId]" />
        <Stack.Screen name="privacy" />
        <Stack.Screen name="delete-account" />
        <Stack.Screen name="subscription" options={{ gestureEnabled: false }} />
      </Stack>
      <ToastHost />
      <DialogHost />
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold });
  const hydrate = useAuth((s) => s.hydrate);
  const status = useAuth((s) => s.status);

  useEffect(() => { void hydrate(); }, [hydrate]);

  const ready = (fontsLoaded || !!fontError) && status !== 'loading';
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ErrorBoundary>
            <Navigator />
          </ErrorBoundary>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
