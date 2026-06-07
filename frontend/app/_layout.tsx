import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '@/context/auth';
import {
  processColdStartOrefTap,
  registerOrefNotificationListener,
  registerOrefTapListener,
} from '@/services/notifications';

export const unstable_settings = {
  anchor: 'login',
};

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const { isLoading, isLoggedIn } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (isLoading) return;
    const inAuthGroup =
      segments[0] === 'login' ||
      segments[0] === 'register' ||
      segments[0] === 'forgot-password';
    if (!isLoggedIn && !inAuthGroup) {
      router.replace('/login');
    } else if (isLoggedIn && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [isLoading, isLoggedIn, segments]);

  // Listen for Oref alert push notifications at the root so they're
  // delivered regardless of which screen the user is on. The handler
  // funnels into AlertsService.injectAlert, which the existing map
  // screen subscriber consumes — banner + auto-nav fire identically.
  //
  // Two listeners + a one-shot cold-start replay:
  //   - foreground push received        → addNotificationReceivedListener
  //   - user taps push from outside app → addNotificationResponseReceivedListener
  //   - app launched BY a tap (cold)    → getLastNotificationResponseAsync
  useEffect(() => {
    const recvSub = registerOrefNotificationListener();
    const tapSub  = registerOrefTapListener();
    processColdStartOrefTap();   // fire-and-forget; runs once on mount
    return () => {
      recvSub.remove();
      tapSub.remove();
    };
  }, []);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' }}>
        <ActivityIndicator size="large" color="#0a7ea4" />
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        {isLoggedIn ? (
          <>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
            <Stack.Screen name="report" options={{ presentation: 'modal', headerShown: false }} />
            <Stack.Screen name="building-registration" options={{ headerShown: false }} />
            <Stack.Screen name="cancel-registration" options={{ headerShown: false }} />
          </>
        ) : (
          <>
            <Stack.Screen name="login" />
            <Stack.Screen name="register" />
            <Stack.Screen name="forgot-password" />
          </>
        )}
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootLayoutNav />
    </AuthProvider>
  );
}
