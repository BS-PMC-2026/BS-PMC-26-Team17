import { Drawer } from "expo-router/drawer";
import { Redirect } from "expo-router";
import React from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAuth } from "@/context/auth";

export default function AppLayout() {
  const colorScheme = useColorScheme();
  const { isLoggedIn, user } = useAuth();
  const isAdmin = user?.role === "admin";

  if (!isLoggedIn) return <Redirect href="/login" />;

  const tint = Colors[colorScheme ?? "light"].tint;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Drawer
        screenOptions={{
          headerShown: true,
          drawerActiveTintColor: tint,
          drawerInactiveTintColor: "#555",
          drawerLabelStyle: { fontSize: 15, fontWeight: "600" },
          drawerStyle: { width: 260 },
        }}
      >
        <Drawer.Screen
          name="index"
          options={{
            title: "Home",
            drawerLabel: "Home",
            drawerIcon: ({ color }) => (
              <IconSymbol size={22} name="house.fill" color={color} />
            ),
          }}
        />
        <Drawer.Screen
          name="map"
          options={{
            title: "Map",
            drawerLabel: "Map",
            drawerIcon: ({ color }) => (
              <IconSymbol size={22} name="map.fill" color={color} />
            ),
          }}
        />
        <Drawer.Screen
          name="settings"
          options={{
            title: "Settings",
            drawerLabel: "Settings",
            drawerIcon: ({ color }) => (
              <IconSymbol size={22} name="gearshape.fill" color={color} />
            ),
          }}
        />
        <Drawer.Screen
          name="ShelterDashboard"
          options={{
            title: "Shelter Dashboard",
            drawerLabel: "Shelter Dashboard",
            drawerIcon: ({ color }) => (
              <IconSymbol size={22} name="list.bullet" color={color} />
            ),
            // drawerItemStyle: isAdmin ? undefined : { display: "none" },
          }}
        />
        <Drawer.Screen
          name="AddShelter"
          options={{
            title: "Add Shelter",
            drawerLabel: "Add Shelter",
            drawerIcon: ({ color }) => (
              <IconSymbol size={22} name="plus.circle.fill" color={color} />
            ),
            // drawerItemStyle: isAdmin ? undefined : { display: "none" },
          }}
        />
        <Drawer.Screen
          name="explore"
          options={{
            title: "Explore",
            drawerLabel: "Explore",
            drawerIcon: ({ color }) => (
              <IconSymbol size={22} name="paperplane.fill" color={color} />
            ),
            drawerItemStyle: isAdmin ? undefined : { display: "none" },
          }}
        />
      </Drawer>
    </GestureHandlerRootView>
  );
}
