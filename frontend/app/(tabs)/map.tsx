import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Text, ActivityIndicator, TouchableOpacity } from 'react-native';
import MapView, { Marker, Callout, PROVIDER_DEFAULT } from 'react-native-maps';
import * as Location from 'expo-location';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';

const ISRAEL_REGION = {
  latitude: 31.5,
  longitude: 34.8,
  latitudeDelta: 3,
  longitudeDelta: 3,
};

type Shelter = {
  name: string;
  address: string;
  city?: string;
  accessStatus: string;
  isAccessible: boolean;
  hasStairs: boolean;
  isFull: boolean;
  capacity: number;
  shouldBeOpen: boolean;
};

type ShelterWithCoords = Shelter & { lat: number; lng: number };

function calcDistance(
  from: { latitude: number; longitude: number } | null,
  to: { lat: number; lng: number }
): string {
  if (!from) return '';
  const R = 6371000;
  const dLat = ((to.lat - from.latitude) * Math.PI) / 180;
  const dLng = ((to.lng - from.longitude) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((from.latitude * Math.PI) / 180) *
      Math.cos((to.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return dist < 1000 ? `${Math.round(dist)} מ׳` : `${(dist / 1000).toFixed(1)} ק״מ`;
}

function markerColor(status: string): string {
  if (status === 'open') return 'green';
  if (status === 'closed' || status === 'locked') return 'red';
  return 'orange';
}

export default function MapScreen() {
  const mapRef = useRef<MapView>(null);
  const [region, setRegion] = useState(ISRAEL_REGION);
  const [loading, setLoading] = useState(true);
  const [locationGranted, setLocationGranted] = useState(false);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [shelters, setShelters] = useState<ShelterWithCoords[]>([]);
  const [geocoding, setGeocoding] = useState(false);

  // בקשת מיקום
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({});
        const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        setRegion({ ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 });
        setUserLocation(coords);
        setLocationGranted(true);
      }
      setLoading(false);
    })();
  }, []);

  // שליפת מקלטים וגיאוקודינג
  useEffect(() => {
    (async () => {
      try {
        setGeocoding(true);
        const res = await fetch(`${API_URL}/shelters`);
        const data = await res.json();
        const raw: Shelter[] = data.shelters || [];

        const results = await Promise.allSettled(
          raw.map(async (shelter) => {
            const query = `${shelter.address}, ${shelter.city || ''}, Israel`;
            const geo = await Location.geocodeAsync(query);
            if (geo.length > 0) {
              return { ...shelter, lat: geo[0].latitude, lng: geo[0].longitude } as ShelterWithCoords;
            }
            return null;
          })
        );

        const withCoords = results
          .filter((r): r is PromiseFulfilledResult<ShelterWithCoords> =>
            r.status === 'fulfilled' && r.value !== null
          )
          .map(r => r.value);

        setShelters(withCoords);
      } catch (e) {
        console.error('Failed to load shelters', e);
      } finally {
        setGeocoding(false);
      }
    })();
  }, []);

  const focusOnUser = () => {
    if (userLocation && mapRef.current) {
      mapRef.current.animateToRegion(
        { ...userLocation, latitudeDelta: 0.01, longitudeDelta: 0.01 },
        500
      );
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1a73e8" />
        <Text style={styles.loadingText}>מאתר מיקום...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={region}
        showsUserLocation={locationGranted}
      >
        {shelters.map((s, i) => (
          <Marker
            key={i}
            coordinate={{ latitude: s.lat, longitude: s.lng }}
            pinColor={markerColor(s.accessStatus)}
          >
            <Callout>
              <View style={styles.callout}>
                <Text style={styles.calloutTitle}>{s.name}</Text>
                <Text style={styles.calloutRow}>{s.address}</Text>
                <Text style={styles.calloutRow}>
                  סטטוס: {s.accessStatus === 'open' ? '✅ פתוח' : s.accessStatus === 'closed' ? '🔴 סגור' : '🟠 לא ידוע'}
                </Text>
                <Text style={styles.calloutRow}>
                  נגיש: {s.isAccessible ? '✅' : '❌'} | מדרגות: {s.hasStairs ? '⚠️' : '✅'}
                </Text>
                <Text style={styles.calloutRow}>
                  קיבולת: {s.capacity ?? '—'} | {s.isFull ? '🔴 מלא' : '✅ פנוי'}
                </Text>
                {userLocation && (
                  <Text style={styles.calloutDistance}>
                    📍 {calcDistance(userLocation, s)}
                  </Text>
                )}
              </View>
            </Callout>
          </Marker>
        ))}
      </MapView>

      {geocoding && (
        <View style={styles.geocodingBadge}>
          <ActivityIndicator size="small" color="#fff" />
          <Text style={styles.geocodingText}>טוען מקלטים...</Text>
        </View>
      )}

      {locationGranted && (
        <TouchableOpacity style={styles.locationButton} onPress={focusOnUser}>
          <Text style={styles.locationIcon}>📍</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 12, color: '#666' },
  locationButton: {
    position: 'absolute',
    bottom: 40,
    right: 16,
    backgroundColor: '#fff',
    borderRadius: 30,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  locationIcon: { fontSize: 22 },
  geocodingBadge: {
    position: 'absolute',
    top: 16,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1a73e8cc',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  geocodingText: { color: '#fff', fontSize: 14 },
  callout: { width: 220, padding: 4 },
  calloutTitle: { fontSize: 15, fontWeight: '700', marginBottom: 6 },
  calloutRow: { fontSize: 13, color: '#333', marginBottom: 3 },
  calloutDistance: { fontSize: 13, color: '#1a73e8', marginTop: 4, fontWeight: '600' },
});
