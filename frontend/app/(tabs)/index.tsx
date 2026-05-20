import { Redirect } from 'expo-router';

/**
 * The map is the centralized main screen for the app. Redirect immediately
 * so the actual implementation can live in `map.tsx` — that preserves the
 * original filename other teammates' branches reference, while still landing
 * the user on the map right after login.
 */
export default function HomeIndex() {
  return <Redirect href="/(tabs)/map" />;
}
