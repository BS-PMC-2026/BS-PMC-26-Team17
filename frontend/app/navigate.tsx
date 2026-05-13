import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, SafeAreaView,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import * as Location from 'expo-location';
import { useLocalSearchParams, router } from 'expo-router';
import { NavigationService, RouteResult } from '@/services/NavigationService';
import type { Mode, Coord } from '@/services/NavigationService';

// ─── Constants ────────────────────────────────────────────────────────────────

const MODES: { key: Mode; label: string; icon: string; desc: string }[] = [
  { key: 'foot',    label: 'Walking',  icon: '🚶', desc: '~5 km/h'  },
  { key: 'cycling', label: 'Cycling',  icon: '🚴', desc: '~15 km/h' },
  { key: 'driving', label: 'Driving',  icon: '🚗', desc: 'by road'  },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function NavigateScreen() {
  const { lat, lng, name, emergency } =
    useLocalSearchParams<{ lat: string; lng: string; name: string; emergency?: string }>();

  const destLat = parseFloat(lat || '0');
  const destLng = parseFloat(lng || '0');
  const dest: Coord = { latitude: destLat, longitude: destLng };
  const isEmergency = emergency === 'true';

  const mapRef         = useRef<MapView>(null);
  const watchRef       = useRef<Location.LocationSubscription | null>(null);
  const stepsRef       = useRef<any[]>([]);
  const polylineRef    = useRef<Coord[]>([]);
  const modeRef        = useRef<Mode>('foot');
  const recalcCooldown = useRef(false);

  const [phase, setPhase]                     = useState<'select' | 'navigating'>(
    isEmergency ? 'navigating' : 'select'   // emergency → straight to navigation
  );
  const [mode, setMode]                       = useState<Mode>('foot');
  const [userLocation, setUserLocation]       = useState<Coord | null>(null);
  const [displayPolyline, setDisplayPolyline] = useState<Coord[]>([]);
  const [steps, setSteps]                     = useState<any[]>([]);
  const [currentStep, setCurrentStep]         = useState(0);
  const [eta, setEta]                         = useState('');
  const [distance, setDistance]               = useState('');
  const [loading, setLoading]                 = useState(isEmergency);
  const [error, setError]                     = useState('');
  const [routeCache, setRouteCache]           = useState<Partial<Record<Mode, RouteResult>>>({});

  // ─── Initial location ─────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setError('Location permission needed'); return; }

      // getLastKnownPositionAsync → instant (cache from map), enough for preview
      const last = await Location.getLastKnownPositionAsync();
      if (last) {
        setUserLocation({ latitude: last.coords.latitude, longitude: last.coords.longitude });
      }

      // getCurrentPositionAsync → more accurate, for actual navigation
      const fresh = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setUserLocation({ latitude: fresh.coords.latitude, longitude: fresh.coords.longitude });
    })();
  }, []);

  useEffect(() => { modeRef.current = mode; }, [mode]);

  // Fetch all three routes in parallel in the background
  useEffect(() => {
    if (!userLocation || isEmergency) return;
    const modes: Mode[] = ['foot', 'cycling', 'driving'];
    modes.forEach(m => {
      NavigationService.fetchRoute(userLocation, dest, m)
        .then(r => setRouteCache(prev => ({ ...prev, [m]: r })))
        .catch(() => {});
    });
  }, [userLocation]);

  // ─── Emergency: auto-start navigation as soon as location is available ─
  useEffect(() => {
    if (!isEmergency || !userLocation) return;
    NavigationService.emergencyRoute(userLocation, dest)
      .then(applyRoute)
      .catch(() => setError('Failed to load emergency route'))
      .finally(() => setLoading(false));
  }, [isEmergency, userLocation]);

  // ─── Apply RouteResult to state ─────────────────────────────────────────
  function applyRoute(result: RouteResult) {
    polylineRef.current = result.polyline;
    stepsRef.current    = result.steps;
    setDisplayPolyline(result.polyline);
    setSteps(result.steps);
    setCurrentStep(0);
    setEta(result.etaLabel);
    setDistance(result.distLabel);
    setPhase('navigating');
  }

  // ─── Manual navigation start (Start button) ─────────────────────────
  const startNavigation = async () => {
    if (!userLocation) { setError('Waiting for location...'); return; }
    // If route was already fetched in background — use it immediately (no extra fetch)
    const cached = routeCache[mode];
    if (cached) { applyRoute(cached); return; }
    // fallback: fetch now
    setLoading(true);
    setError('');
    try {
      const result = await NavigationService.fetchRoute(userLocation, dest, mode);
      applyRoute(result);
    } catch {
      setError('Failed to load route');
    } finally {
      setLoading(false);
    }
  };

  // ─── GPS watch — only starts when navigation is active ───────────────
  useEffect(() => {
    if (phase !== 'navigating') return;
    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, distanceInterval: 10 },
      (loc) => {
        const coords: Coord = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        mapRef.current?.animateToRegion(
          { ...coords, latitudeDelta: 0.005, longitudeDelta: 0.005 }, 300
        );
        advanceOnRoute(coords);
      }
    ).then(sub => { watchRef.current = sub; });
    return () => { watchRef.current?.remove(); };
  }, [phase]);

  // ─── Update location during navigation ────────────────────────────────
  function advanceOnRoute(pos: Coord) {
    if (stepsRef.current.length > 0) {
      setCurrentStep(NavigationService.nearestStepIndex(stepsRef.current, pos));
    }
    if (polylineRef.current.length > 0) {
      const { polyline: remaining, distanceM } =
        NavigationService.remainingRoute(polylineRef.current, pos);
      setDisplayPolyline(remaining);
      setDistance(NavigationService.formatDistance(distanceM));
      setEta(NavigationService.formatDuration(
        NavigationService.calculateETA(distanceM, modeRef.current)
      ));

      // Off-route → recalculate
      if (!recalcCooldown.current &&
          NavigationService.isOffRoute(pos, polylineRef.current)) {
        recalcCooldown.current = true;
        setUserLocation({ ...pos });
        setTimeout(() => { recalcCooldown.current = false; }, 8000);
      }
    }
  }

  const arrived = steps[currentStep]?.maneuver?.type === 'arrive';

  // Mode selection screen
  if (phase === 'select') {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity style={s.closeBtn} onPress={() => router.back()}>
            <Text style={s.closeIcon}>✕</Text>
          </TouchableOpacity>
          <View style={s.headerInfo}>
            <Text style={s.destName} numberOfLines={1}>{name || 'Shelter'}</Text>
            <Text style={s.destSub}>Choose how to get there</Text>
          </View>
        </View>

        <View style={s.modeCards}>
          {MODES.map(m => {
            const cached   = routeCache[m.key];
            const etaLabel = cached ? cached.etaLabel  : null;
            const distLabel = cached ? cached.distLabel : null;
            return (
              <TouchableOpacity
                key={m.key}
                style={[s.modeCard, mode === m.key && s.modeCardOn]}
                onPress={() => setMode(m.key)}
              >
                <Text style={s.modeCardIcon}>{m.icon}</Text>
                <Text style={[s.modeCardLabel, mode === m.key && s.modeCardLabelOn]}>{m.label}</Text>
                <Text style={s.modeCardDesc}>{m.desc}</Text>
                {etaLabel ? (
                  <>
                    <Text style={[s.modeCardEta, mode === m.key && s.modeCardEtaOn]}>{etaLabel}</Text>
                    <Text style={s.modeCardDist}>~{distLabel}</Text>
                  </>
                ) : (
                  <ActivityIndicator size="small" color="#ccc" style={{ marginTop: 8 }} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {!!error && <Text style={s.errorText}>{error}</Text>}

        <TouchableOpacity
          style={[s.startBtn, (loading || !userLocation) && s.startBtnDisabled]}
          onPress={startNavigation}
          disabled={loading || !userLocation}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.startBtnText}>
                {userLocation ? '🧭  Start Navigation' : 'Getting location...'}
              </Text>
          }
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // Navigation screen
  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity style={s.closeBtn} onPress={() => router.back()}>
          <Text style={s.closeIcon}>✕</Text>
        </TouchableOpacity>
        <View style={s.headerInfo}>
          <Text style={s.destName} numberOfLines={1}>{name || 'Shelter'}</Text>
          {eta && distance && <Text style={s.etaText}>{eta}  ·  {distance}</Text>}
        </View>
      </View>

      {loading ? (
        <View style={s.loadingFull}>
          <ActivityIndicator size="large" color="#1a73e8" />
          <Text style={s.loadingText}>
            {isEmergency ? '🚨 Loading emergency route...' : 'Calculating route...'}
          </Text>
        </View>
      ) : (
        <MapView
          ref={mapRef}
          style={s.map}
          provider={PROVIDER_DEFAULT}
          showsUserLocation={true}
          initialRegion={{
            latitude:  userLocation?.latitude  ?? destLat,
            longitude: userLocation?.longitude ?? destLng,
            latitudeDelta: 0.05, longitudeDelta: 0.05,
          }}
        >
          {displayPolyline.length >= 2 && (
            <Polyline
              coordinates={displayPolyline}
              strokeColor={isEmergency ? '#e53935' : '#1a73e8'}
              strokeWidth={4}
            />
          )}
          <Marker
            coordinate={dest}
            pinColor="red"
            title={name || 'Shelter'}
          />
        </MapView>
      )}

      <View style={[s.hud, arrived && s.hudArrived, isEmergency && !arrived && s.hudEmergency]}>
        {error ? (
          <Text style={s.hudError}>{error}</Text>
        ) : steps.length > 0 ? (
          <>
            <Text style={s.hudStep}>{NavigationService.stepInstruction(steps[currentStep])}</Text>
            {!arrived && steps[currentStep + 1] && (
              <Text style={s.hudNext}>
                Then: {NavigationService.stepInstruction(steps[currentStep + 1])}
              </Text>
            )}
          </>
        ) : (
          <Text style={s.hudStep}>
            {isEmergency ? '🚨 Emergency navigation...' : 'Locating...'}
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#fff' },
  header:           { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  closeBtn:         { width: 36, height: 36, borderRadius: 18, backgroundColor: '#f2f2f2', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  closeIcon:        { fontSize: 16, color: '#555' },
  headerInfo:       { flex: 1 },
  destName:         { fontSize: 17, fontWeight: '700', color: '#111' },
  destSub:          { fontSize: 13, color: '#888', marginTop: 2 },
  etaText:          { fontSize: 13, color: '#1a73e8', marginTop: 2 },
  // Mode cards
  modeCards:        { flexDirection: 'row', gap: 12, padding: 24 },
  modeCard:         { flex: 1, alignItems: 'center', paddingVertical: 20, borderRadius: 16, borderWidth: 2, borderColor: '#e0e0e0', backgroundColor: '#fafafa' },
  modeCardOn:       { borderColor: '#1a73e8', backgroundColor: '#e8f0fe' },
  modeCardIcon:     { fontSize: 32, marginBottom: 8 },
  modeCardLabel:    { fontSize: 14, fontWeight: '600', color: '#555' },
  modeCardLabelOn:  { color: '#1a73e8' },
  modeCardDesc:     { fontSize: 11, color: '#aaa', marginTop: 4 },
  modeCardEta:      { fontSize: 13, fontWeight: '700', color: '#555', marginTop: 8 },
  modeCardEtaOn:    { color: '#1a73e8' },
  modeCardDist:     { fontSize: 11, color: '#aaa', marginTop: 2 },
  // Error / loading
  errorText:        { textAlign: 'center', color: '#e53935', marginHorizontal: 24, marginBottom: 8 },
  loadingFull:      { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText:      { fontSize: 15, color: '#555' },
  // Start button
  startBtn:         { marginHorizontal: 24, marginTop: 'auto', marginBottom: 32, backgroundColor: '#1a73e8', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  startBtnDisabled: { backgroundColor: '#93b9f5' },
  startBtnText:     { color: '#fff', fontSize: 17, fontWeight: '700' },
  // Map
  map:              { flex: 1 },
  // HUD
  hud:              { backgroundColor: '#1a73e8', paddingHorizontal: 20, paddingVertical: 16, minHeight: 80, justifyContent: 'center' },
  hudArrived:       { backgroundColor: '#1D9E75' },
  hudEmergency:     { backgroundColor: '#e53935' },
  hudStep:          { fontSize: 18, fontWeight: '700', color: '#fff', textAlign: 'left' },
  hudNext:          { fontSize: 13, color: '#ffffffaa', marginTop: 6, textAlign: 'left' },
  hudError:         { fontSize: 16, color: '#fff', textAlign: 'center' },
});
