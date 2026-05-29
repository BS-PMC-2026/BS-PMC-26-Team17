import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, SafeAreaView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { useLocalSearchParams, router } from 'expo-router';
import { NavigationService, RouteResult } from '@/services/NavigationService';
import type { Mode, Coord } from '@/services/NavigationService';
import SimJoystick from '@/components/SimJoystick';

// ─── Constants ────────────────────────────────────────────────────────────────

const MODES: { key: Mode; label: string; icon: string; desc: string }[] = [
  { key: 'foot',    label: 'Walking',  icon: '🚶', desc: '~5 km/h'  },
  { key: 'cycling', label: 'Cycling',  icon: '🚴', desc: '~15 km/h' },
  { key: 'driving', label: 'Driving',  icon: '🚗', desc: 'by road'  },
];

// ─── Leaflet map HTML (in-WebView runtime) ───────────────────────────────────
// Same pattern as the main map: a self-contained Leaflet instance that the RN
// side talks to via JSON postMessage. Polyline + user marker + destination.
const MAP_HTML = `<!DOCTYPE html><html lang="he"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html,body,#map { margin:0; padding:0; width:100vw; height:100vh; }
  .user-dot {
    width:18px;height:18px;border-radius:9px;background:#1a73e8;
    border:3px solid #fff;box-shadow:0 0 6px rgba(0,0,0,.4);
  }
  .dest-pin {
    width:22px;height:22px;border-radius:50% 50% 50% 0;
    background:#e53935;border:2px solid #fff;
    transform:rotate(-45deg);box-shadow:0 0 4px rgba(0,0,0,.4);
  }
</style></head><body>
<div id="map"></div>
<script>
  var map = L.map('map', { zoomControl:false, attributionControl:false })
              .setView([31.5, 34.8], 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom: 19 }).addTo(map);

  var userMarker = null;
  var destMarker = null;
  var routeLine  = null;

  function send(obj) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(obj));
    }
  }

  function handle(raw) {
    var msg;
    try { msg = JSON.parse(raw); } catch(_) { return; }

    if (msg.type === 'setDestination') {
      var ll = [msg.lat, msg.lng];
      if (destMarker) { destMarker.setLatLng(ll); }
      else {
        destMarker = L.marker(ll, {
          icon: L.divIcon({ className:'', html:'<div class="dest-pin"></div>', iconSize:[22,22], iconAnchor:[11,22] }),
        }).addTo(map);
      }
    }

    else if (msg.type === 'setUserLocation') {
      var ll = [msg.lat, msg.lng];
      if (userMarker) { userMarker.setLatLng(ll); }
      else {
        userMarker = L.marker(ll, {
          icon: L.divIcon({ className:'', html:'<div class="user-dot"></div>', iconSize:[18,18] }),
          interactive: false,
          zIndexOffset: 1000,
        }).addTo(map);
      }
    }

    else if (msg.type === 'setRoute') {
      if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
      if (msg.data && msg.data.coords && msg.data.coords.length >= 2) {
        var latlngs = msg.data.coords.map(function(c) { return [c.lat, c.lng]; });
        routeLine = L.polyline(latlngs, {
          color: msg.data.color || '#1a73e8',
          weight: 5,
          opacity: 0.85,
        }).addTo(map);
      }
    }

    else if (msg.type === 'flyTo') {
      // Honor msg.duration so the sim can request shorter animations that
      // don't pile up between rapid GPS ticks (default = 0.4s).
      map.setView([msg.lat, msg.lng], msg.zoom || 16, {
        animate: true,
        duration: typeof msg.duration === 'number' ? msg.duration : 0.4,
      });
    }

    else if (msg.type === 'fitBounds') {
      if (msg.coords && msg.coords.length >= 2) {
        var latlngs = msg.coords.map(function(c) { return [c.lat, c.lng]; });
        map.fitBounds(latlngs, { padding: [50, 50] });
      }
    }
  }

  window.addEventListener('message', function(e) { handle(e.data); });
  document.addEventListener('message', function(e) { handle(e.data); });

  send({ type:'ready' });
</script>
</body></html>`;

// ─── Component ───────────────────────────────────────────────────────────────

export default function NavigateScreen() {
  const { lat, lng, name, emergency, fromLat, fromLng } =
    useLocalSearchParams<{
      lat: string; lng: string; name: string; emergency?: string;
      // When the SimJoystick on the map was active, these carry the fake
      // start position so navigation begins from the simulated dot instead
      // of waiting for real GPS.
      fromLat?: string; fromLng?: string;
    }>();

  const destLat = parseFloat(lat || '0');
  const destLng = parseFloat(lng || '0');
  const dest: Coord = { latitude: destLat, longitude: destLng };
  const isEmergency = emergency === 'true';
  // Pre-computed "from" override from the URL — null when not provided.
  const fromOverride: Coord | null =
    fromLat && fromLng
      ? { latitude: parseFloat(fromLat), longitude: parseFloat(fromLng) }
      : null;

  const webRef         = useRef<WebView>(null);
  const watchRef       = useRef<Location.LocationSubscription | null>(null);
  const stepsRef       = useRef<any[]>([]);
  const polylineRef    = useRef<Coord[]>([]);
  const modeRef        = useRef<Mode>('foot');
  const recalcCooldown = useRef(false);

  const [phase, setPhase]               = useState<'select' | 'navigating'>(
    isEmergency ? 'navigating' : 'select'
  );
  const [mode, setMode]                 = useState<Mode>('foot');
  // Seed userLocation immediately from the override so the background route
  // fetch (3 modes in parallel) starts right away instead of waiting on GPS.
  const [userLocation, setUserLocation] = useState<Coord | null>(fromOverride);
  const [steps, setSteps]               = useState<any[]>([]);
  const [currentStep, setCurrentStep]   = useState(0);
  const [eta, setEta]                   = useState('');
  const [distance, setDistance]         = useState('');
  const [loading, setLoading]           = useState(isEmergency);
  const [error, setError]               = useState('');
  const [routeCache, setRouteCache]     = useState<Partial<Record<Mode, RouteResult>>>({});
  const [webReady, setWebReady]         = useState(false);
  // Sim joystick — manual QA tool that fakes GPS without leaving the office.
  // While `simOn`, the real GPS watch pauses and `simCoords` drives the map.
  // If a `from` override was provided, start with the sim already on so
  // route fetches use it (instead of racing against real GPS).
  const [simOn, setSimOn]               = useState<boolean>(!!fromOverride);
  const [simCoords, setSimCoords]       = useState<Coord | null>(fromOverride);

  // Helper — send a JSON message into the WebView
  const sendToWeb = useCallback((obj: any) => {
    webRef.current?.postMessage(JSON.stringify(obj));
  }, []);

  // Convert RN Coord polyline → Leaflet-friendly {lat,lng} list and push it.
  const pushRouteToMap = useCallback((coords: Coord[]) => {
    const data = coords.map(c => ({ lat: c.latitude, lng: c.longitude }));
    sendToWeb({
      type: 'setRoute',
      data: { coords: data, color: isEmergency ? '#e53935' : '#1a73e8' },
    });
  }, [sendToWeb, isEmergency]);

  // ─── Initial location ─────────────────────────────────────────────────────────
  useEffect(() => {
    // If the caller seeded us with a fake "from" point (sim joystick on the
    // map screen), skip the GPS lookup entirely — otherwise the real GPS
    // reading would overwrite the sim start.
    if (fromOverride) return;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setError('Location permission needed'); return; }

      const last = await Location.getLastKnownPositionAsync();
      if (last) {
        setUserLocation({ latitude: last.coords.latitude, longitude: last.coords.longitude });
      }
      const fresh = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setUserLocation({ latitude: fresh.coords.latitude, longitude: fresh.coords.longitude });
    })();
  }, []);

  useEffect(() => { modeRef.current = mode; }, [mode]);

  // Fetch all three routes in parallel in the background (for the select screen)
  useEffect(() => {
    if (!userLocation || isEmergency) return;
    const modes: Mode[] = ['foot', 'cycling', 'driving'];
    modes.forEach(m => {
      NavigationService.fetchRoute(userLocation, dest, m)
        .then(r => setRouteCache(prev => ({ ...prev, [m]: r })))
        .catch(e => console.warn(`[Nav] ${m} fetch failed:`, e));
    });
  }, [userLocation]);

  // ─── Push destination + initial user marker once the WebView reports ready ─
  useEffect(() => {
    if (!webReady) return;
    sendToWeb({ type: 'setDestination', lat: destLat, lng: destLng });
    if (userLocation) {
      sendToWeb({
        type: 'setUserLocation',
        lat: userLocation.latitude,
        lng: userLocation.longitude,
      });
    }
  }, [webReady, destLat, destLng, userLocation, sendToWeb]);

  // ─── Whenever we transition to the navigating screen with a route, draw it
  //     and fit the bounds so both endpoints are visible.
  useEffect(() => {
    if (!webReady || phase !== 'navigating' || polylineRef.current.length === 0) return;
    pushRouteToMap(polylineRef.current);
    const coords = polylineRef.current.map(c => ({ lat: c.latitude, lng: c.longitude }));
    sendToWeb({ type: 'fitBounds', coords });
  }, [webReady, phase, pushRouteToMap, sendToWeb]);

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
    setSteps(result.steps);
    setCurrentStep(0);
    setEta(result.etaLabel);
    setDistance(result.distLabel);
    setPhase('navigating');
    // Draw the route now (also re-runs via the webReady effect if needed)
    pushRouteToMap(result.polyline);
    const coords = result.polyline.map(c => ({ lat: c.latitude, lng: c.longitude }));
    sendToWeb({ type: 'fitBounds', coords });
  }

  // ─── Manual Start ───────────────────────────────────────────────────────
  const startNavigation = async () => {
    if (!userLocation) { setError('Waiting for location...'); return; }
    const cached = routeCache[mode];
    if (cached) { applyRoute(cached); return; }
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

  // ─── GPS watch — starts only when navigating AND sim is off ──────────────
  useEffect(() => {
    if (phase !== 'navigating' || simOn) return; // sim takes over when active
    let cancelled = false;
    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, distanceInterval: 10 },
      (loc) => {
        const coords: Coord = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        // Move the in-map user dot and pan the camera to follow the user.
        sendToWeb({ type: 'setUserLocation', lat: coords.latitude, lng: coords.longitude });
        sendToWeb({ type: 'flyTo', lat: coords.latitude, lng: coords.longitude, zoom: 17 });
        advanceOnRoute(coords);
      }
    ).then(sub => {
      if (cancelled) { sub.remove(); return; }
      watchRef.current = sub;
    });
    return () => {
      cancelled = true;
      watchRef.current?.remove();
      watchRef.current = null;
    };
  }, [phase, simOn, sendToWeb]);

  // ─── Sim joystick drives the map while active ────────────────────────────
  useEffect(() => {
    if (!simOn || !simCoords) return;
    sendToWeb({ type: 'setUserLocation', lat: simCoords.latitude, lng: simCoords.longitude });
    // Animation must fit inside the 400ms sim tick — otherwise overlapping
    // flyTo animations stack and the camera jumps backwards.
    sendToWeb({ type: 'flyTo', lat: simCoords.latitude, lng: simCoords.longitude, zoom: 17, duration: 0.3 });
    advanceOnRoute(simCoords);
    // We intentionally omit `advanceOnRoute` from deps — it's a stable inline
    // function defined below that closes over refs, not state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simOn, simCoords, sendToWeb]);

  // 📍 button — fly the map to the user's current position. When the sim
  // is on, we follow the sim marker (which is what's actually displayed).
  const focusOnUser = () => {
    const target = simOn ? simCoords : userLocation;
    if (!target) return;
    sendToWeb({ type: 'flyTo', lat: target.latitude, lng: target.longitude, zoom: 17 });
  };

  const toggleSim = () => {
    if (simOn) {
      setSimOn(false);
      setSimCoords(null);
      return;
    }
    // Seed the sim at the user's current real location (or the destination
    // as a last-resort fallback so the marker has somewhere to go).
    const seed = userLocation ?? dest;
    setSimCoords(seed);
    setSimOn(true);
    // Snap the camera to that seed immediately — gives the user the same
    // "you are here" feedback that the 📍 button would, without needing a
    // second tap after turning the joystick on.
    sendToWeb({ type: 'flyTo', lat: seed.latitude, lng: seed.longitude, zoom: 17 });
  };

  // Throttled joystick → GPS-style location updates.
  // The joystick fires up to ~60×/sec; storing the direction in a ref keeps
  // the reactive surface small (no re-renders per touch event). A separate
  // interval reads the latest intent and produces ~2.5 location updates/sec,
  // close to what real GPS emits while walking.
  //
  // We don't rely on `onPanResponderRelease` to stop movement — on iOS that
  // event can be missed if the user lifts a finger outside the joystick pad.
  // Instead we use a "deadman switch": if `handleJoyMove` hasn't fired in
  // the last 250ms, assume the user released and stop stepping.
  const moveIntent = useRef({ dx: 0, dy: 0 });
  const lastMoveAt = useRef(0);

  const handleJoyMove = (dx: number, dy: number) => {
    lastMoveAt.current = Date.now();
    moveIntent.current = { dx, dy };
  };

  const handleJoyStop = () => {
    moveIntent.current = { dx: 0, dy: 0 };
  };

  useEffect(() => {
    if (!simOn) return;
    const SIM_TICK_MS    = 400;      // ≈ 2.5 GPS-style updates per second
    const STEP           = 0.00006;  // ≈ 6m per fully-pushed tick (walking pace)
    const STALE_MOVE_MS  = 250;      // if onMove hasn't fired in this window → "released"
    const id = setInterval(() => {
      // Deadman switch — joystick events stop coming when the finger lifts,
      // so we infer release from staleness rather than trust onPanResponderRelease.
      if (Date.now() - lastMoveAt.current > STALE_MOVE_MS) {
        moveIntent.current = { dx: 0, dy: 0 };
        return;
      }
      const { dx, dy } = moveIntent.current;
      if (dx === 0 && dy === 0) return; // joystick at rest → no movement
      setSimCoords(prev => {
        const base = prev ?? userLocation ?? dest;
        return {
          latitude:  base.latitude  - dy * STEP, // up on screen = north
          longitude: base.longitude + dx * STEP,
        };
      });
    }, SIM_TICK_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simOn]);

  // ─── Update step / remaining polyline / ETA on every GPS tick ───────────
  function advanceOnRoute(pos: Coord) {
    if (stepsRef.current.length > 0) {
      setCurrentStep(NavigationService.nearestStepIndex(stepsRef.current, pos));
    }
    if (polylineRef.current.length > 0) {
      const { polyline: remaining, distanceM } =
        NavigationService.remainingRoute(polylineRef.current, pos);
      // Re-draw shrinking polyline as the user advances along the route
      pushRouteToMap(remaining);
      setDistance(NavigationService.formatDistance(distanceM));
      setEta(NavigationService.formatDuration(
        NavigationService.calculateETA(distanceM, modeRef.current)
      ));

      // Off-route → fetch a fresh route from the current position and
      // actually APPLY it (not just refresh the background cache). This is
      // the same flow as the initial Start tap, so it works identically for
      // real GPS and the SimJoystick — the polyline + steps + ETA all
      // update to reflect the new path from where the user actually is.
      if (!recalcCooldown.current &&
          NavigationService.isOffRoute(pos, polylineRef.current)) {
        recalcCooldown.current = true;
        NavigationService.fetchRoute(pos, dest, modeRef.current)
          .then(applyRoute)
          .catch(e => console.warn('[Nav] off-route recalc failed:', e))
          .finally(() => {
            // Brief cooldown — long enough to avoid hammering OSRM each tick,
            // short enough to react quickly if the user keeps straying.
            setTimeout(() => { recalcCooldown.current = false; }, 3000);
          });
      }
    }
  }

  const arrived = steps[currentStep]?.maneuver?.type === 'arrive';

  // ─── Mode-select screen ─────────────────────────────────────────────────
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
            const cached    = routeCache[m.key];
            const etaLabel  = cached ? cached.etaLabel  : null;
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

  // ─── Navigation screen ──────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity style={s.closeBtn} onPress={() => router.back()}>
          <Text style={s.closeIcon}>✕</Text>
        </TouchableOpacity>
        <View style={s.headerInfo}>
          <Text style={s.destName} numberOfLines={1}>{name || 'Shelter'}</Text>
          {eta && distance && <Text style={s.etaText}>{eta}  ·  {distance}</Text>}
          <Text style={s.destSub}>
            {mode === 'foot' ? '🚶 Walking' : mode === 'cycling' ? '🚴 Cycling' : '🚗 Driving'}
          </Text>
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
        <View style={s.mapWrap}>
          <WebView
            ref={webRef}
            style={s.map}
            source={{ html: MAP_HTML }}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            onMessage={(event) => {
              try {
                const msg = JSON.parse(event.nativeEvent.data);
                if (msg.type === 'ready') setWebReady(true);
              } catch { /* ignore non-JSON */ }
            }}
            testID="navigate-webview"
          />

          {/* 📍 current-location button — bottom-right corner. */}
          <TouchableOpacity
            style={s.locateBtn}
            onPress={focusOnUser}
            testID="locate-button"
            accessibilityLabel="Center on my location"
          >
            <Text style={s.locateIcon}>📍</Text>
          </TouchableOpacity>

          {/* Sim toggle — sits just above 📍. Hidden by default; tap to
              reveal the joystick for manual position simulation. */}
          <TouchableOpacity
            style={s.simToggle}
            onPress={toggleSim}
            testID="sim-toggle"
            accessibilityLabel="Toggle sim joystick"
          >
            <Text style={s.simToggleIcon}>{simOn ? '🎮' : '👁️'}</Text>
          </TouchableOpacity>

          {/* Joystick itself — only mounted when the sim is on. Positioned
              just above the toggle so the user can keep their thumb in the
              corner without obscuring the route line. */}
          {simOn && (
            <View style={s.simJoyWrap} pointerEvents="box-none">
              <SimJoystick onMove={handleJoyMove} onStop={handleJoyStop} />
            </View>
          )}
        </View>
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
  mapWrap:          { flex: 1, position: 'relative' },
  map:              { flex: 1 },
  // 📍 current-location — bottom-right.
  locateBtn: {
    position: 'absolute', bottom: 16, right: 16,
    backgroundColor: '#fff', borderRadius: 24, width: 48, height: 48,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25, shadowRadius: 4, elevation: 5,
    zIndex: 10,
  },
  locateIcon: { fontSize: 22 },
  // Sim joystick toggle — sits one button above 📍.
  simToggle: {
    position: 'absolute', bottom: 76, right: 16,
    backgroundColor: '#fff', borderRadius: 24, width: 48, height: 48,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25, shadowRadius: 4, elevation: 5,
    zIndex: 10,
  },
  simToggleIcon: { fontSize: 22 },
  // Joystick container — bottom-center so the user can drive with one
  // thumb in the middle of the screen without the corner buttons being
  // hidden by their hand.
  simJoyWrap: {
    position: 'absolute',
    bottom: 140,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9,
  },
  // HUD
  hud:              { backgroundColor: '#1a73e8', paddingHorizontal: 20, paddingVertical: 16, minHeight: 80, justifyContent: 'center' },
  hudArrived:       { backgroundColor: '#1D9E75' },
  hudEmergency:     { backgroundColor: '#e53935' },
  hudStep:          { fontSize: 18, fontWeight: '700', color: '#fff', textAlign: 'left' },
  hudNext:          { fontSize: 13, color: '#ffffffaa', marginTop: 6, textAlign: 'left' },
  hudError:         { fontSize: 16, color: '#fff', textAlign: 'center' },
});
