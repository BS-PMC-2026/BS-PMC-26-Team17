import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Text, ActivityIndicator, TouchableOpacity } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import * as Location from 'expo-location';
import { router } from 'expo-router';

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

export function calcDistance(
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

export function markerBg(status: string): string {
  if (status === 'open') return '#1D9E75';
  if (status === 'closed' || status === 'locked') return '#E24B4A';
  return '#BA7517';
}

// Custom marker — pointerEvents="none" מבטיח שהמגע עובר ל-Marker
function ShelterPin({ status }: { status: string }) {
  const bg = markerBg(status);
  return (
    <View pointerEvents="none" style={mk.wrap}>
      <View style={[mk.circle, { backgroundColor: bg }]}>
        <Text style={mk.icon}>🏠</Text>
      </View>
      <View style={[mk.tip, { borderTopColor: bg }]} />
    </View>
  );
}

const mk = StyleSheet.create({
  wrap:   { alignItems: 'center' },
  circle: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3, shadowRadius: 3, elevation: 5,
  },
  icon: { fontSize: 18 },
  tip:  {
    width: 0, height: 0,
    borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 8,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
  },
});

export default function MapScreen() {
  const mapRef = useRef<MapView>(null);
  const [loading, setLoading] = useState(true);
  const [locationGranted, setLocationGranted] = useState(false);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [shelters, setShelters] = useState<ShelterWithCoords[]>([]);
  const [geocoding, setGeocoding] = useState(false);
  const [selectedShelter, setSelectedShelter] = useState<ShelterWithCoords | null>(null);

  // בקשת מיקום
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
          setUserLocation(coords);
          setLocationGranted(true);
          mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 500);
        }
      } catch (e) {
        console.error('Location error:', e);
      } finally {
        setLoading(false);
      }
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
        initialRegion={ISRAEL_REGION}
        showsUserLocation={locationGranted}
        showsMyLocationButton={false}
        // סוגרים פאנל רק אם לא לחצו על סמן
        onPress={() => setSelectedShelter(null)}
      >
        {shelters.map((s, i) => (
          <Marker
            key={i}
            coordinate={{ latitude: s.lat, longitude: s.lng }}
            tracksViewChanges={false}
            onPress={(e) => {
              e?.stopPropagation?.();       // ← מונע הגעה ל-MapView.onPress
              setSelectedShelter(s);
            }}
          >
            <ShelterPin status={s.accessStatus} />
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

      {/* פאנל מידע מקלט */}
      {selectedShelter && (
        <View style={styles.panel} testID="shelter-panel">
          <TouchableOpacity style={styles.panelClose} onPress={() => setSelectedShelter(null)}>
            <Text style={styles.panelCloseText}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.panelTitle}>{selectedShelter.name}</Text>
          <Text style={styles.panelRow}>{selectedShelter.address}</Text>
          <Text style={styles.panelRow}>
            סטטוס:{' '}
            {selectedShelter.accessStatus === 'open'
              ? '✅ פתוח'
              : selectedShelter.accessStatus === 'closed'
              ? '🔴 סגור'
              : '🟠 לא ידוע'}
          </Text>
          <Text style={styles.panelRow}>
            נגיש: {selectedShelter.isAccessible ? '✅' : '❌'} | מדרגות:{' '}
            {selectedShelter.hasStairs ? '⚠️' : '✅'}
          </Text>
          <Text style={styles.panelRow}>
            קיבולת: {selectedShelter.capacity ?? '—'} |{' '}
            {selectedShelter.isFull ? '🔴 מלא' : '✅ פנוי'}
          </Text>
          {userLocation && (
            <Text style={styles.panelDistance}>
              📍 {calcDistance(userLocation, selectedShelter)}
            </Text>
          )}
          <TouchableOpacity
            style={styles.navigateBtn}
            onPress={() =>
              router.push(
                `/navigate?lat=${selectedShelter.lat}&lng=${selectedShelter.lng}&name=${encodeURIComponent(selectedShelter.name)}`
              )
            }
          >
            <Text style={styles.navigateBtnText}>🧭 נווט למקלט</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1 },
  map:          { flex: 1 },
  center:       { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText:  { marginTop: 12, color: '#666' },
  locationButton: {
    position: 'absolute', bottom: 40, right: 16,
    backgroundColor: '#fff', borderRadius: 30,
    width: 48, height: 48,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25, shadowRadius: 4, elevation: 5,
  },
  locationIcon: { fontSize: 22 },
  geocodingBadge: {
    position: 'absolute', top: 16, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#1a73e8cc',
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
  },
  geocodingText: { color: '#fff', fontSize: 14 },
  panel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    padding: 20, paddingBottom: 36,
    shadowColor: '#000', shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.15, shadowRadius: 8, elevation: 10,
  },
  panelClose:     { position: 'absolute', top: 14, right: 16, padding: 6 },
  panelCloseText: { fontSize: 18, color: '#888' },
  panelTitle:     { fontSize: 17, fontWeight: '700', marginBottom: 8, marginRight: 30 },
  panelRow:       { fontSize: 13, color: '#444', marginBottom: 4 },
  panelDistance:  { fontSize: 13, color: '#1a73e8', marginTop: 4, fontWeight: '600', marginBottom: 12 },
  navigateBtn:    {
    backgroundColor: '#1a73e8', borderRadius: 10,
    paddingVertical: 12, alignItems: 'center', marginTop: 8,
  },
  navigateBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
