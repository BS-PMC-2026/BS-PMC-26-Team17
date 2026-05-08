import { useEffect, useRef, useState } from 'react';
import {
  View, StyleSheet, Text, ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import * as Location from 'expo-location';
import { router } from 'expo-router';

const ISRAEL_REGION = {
  latitude: 31.5,
  longitude: 34.8,
  latitudeDelta: 3,
  longitudeDelta: 3,
};

type Pin = { latitude: number; longitude: number; name: string };

export default function MapScreen() {
  const mapRef = useRef<MapView>(null);
  const [region, setRegion]                   = useState(ISRAEL_REGION);
  const [loading, setLoading]                 = useState(true);
  const [locationGranted, setLocationGranted] = useState(false);
  const [userLocation, setUserLocation]       = useState<{ latitude: number; longitude: number } | null>(null);
  const [pin, setPin]                         = useState<Pin | null>(null);

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

  const focusOnUser = () => {
    if (userLocation && mapRef.current) {
      mapRef.current.animateToRegion(
        { ...userLocation, latitudeDelta: 0.01, longitudeDelta: 0.01 },
        500
      );
    }
  };

  // ── לחיצה על המפה → סמן + פאנל ────────────────────────────────────────────
  const handleMapPress = (e: any) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setPin({
      latitude,
      longitude,
      name: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
    });
  };

  const navigateToPin = () => {
    if (!pin) return;
    router.push(
      `/navigate?lat=${pin.latitude}&lng=${pin.longitude}&name=${encodeURIComponent(pin.name)}`
    );
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
      {/* מפה */}
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={region}
        showsUserLocation={locationGranted}
        onPress={handleMapPress}
      >
        {pin && (
          <Marker
            key={`${pin.latitude}-${pin.longitude}`}
            coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
            pinColor="#1a73e8"
          />
        )}
      </MapView>

      {/* כפתור מיקום */}
      {locationGranted && (
        <TouchableOpacity
          style={[styles.locationButton, pin ? styles.locationButtonWithPanel : null]}
          onPress={focusOnUser}
        >
          <Text style={styles.locationIcon}>📍</Text>
        </TouchableOpacity>
      )}

      {/* פאנל תחתון */}
      {pin && (
        <View style={styles.panel}>
          <TouchableOpacity style={styles.panelClose} onPress={() => setPin(null)}>
            <Text style={styles.panelCloseText}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.panelName} numberOfLines={2}>{pin.name}</Text>
          <TouchableOpacity style={styles.navBtn} onPress={navigateToPin}>
            <Text style={styles.navBtnText}>🧭  נווט לכאן</Text>
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
  locationButtonWithPanel: {
    bottom: 170,
  },
  locationIcon: { fontSize: 22 },

  panel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 10,
  },
  panelClose:     { position: 'absolute', top: 14, right: 16, padding: 6 },
  panelCloseText: { fontSize: 18, color: '#aaa' },
  panelName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#222',
    marginBottom: 16,
    marginRight: 32,
    textAlign: 'right',
  },
  navBtn: {
    backgroundColor: '#1a73e8',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  navBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
