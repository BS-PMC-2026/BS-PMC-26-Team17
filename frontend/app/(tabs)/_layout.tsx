import { Stack, Redirect } from "expo-router";
import React from "react";

import { useAuth } from "@/context/auth";
import { useHomeGeofence } from "@/hooks/use-home-geofence";

/**
 * Stack-based layout. The Drawer / sidebar was intentionally removed —
 * the Home screen (map) is now the single hub, and other screens are
 * reached by direct navigation (e.g. the ⚙️ button on the map → Settings).
 * Each screen renders its own header, so we hide the native one here.
 */
export default function AppLayout() {
  const { isLoggedIn } = useAuth();
  useHomeGeofence();

  if (!isLoggedIn) return <Redirect href="/login" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
