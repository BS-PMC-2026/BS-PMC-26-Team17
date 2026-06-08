import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, SafeAreaView, ScrollView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { useLocalSearchParams, router } from 'expo-router';
import { NavigationService, RouteResult } from '@/services/NavigationService';
import type { Mode, Coord } from '@/services/NavigationService';
import SimJoystick from '@/components/SimJoystick';
import SirenGroupPromptModal from '@/components/SirenGroupPromptModal';
import { ReservationService } from '@/services/ReservationService';
import { useAuth } from '@/context/auth';
import { API_URL } from '@/config';
import { getAlertTime } from '@/services/alertTimes';
import { OrefZonesService } from '@/services/OrefZonesService';

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
  const {
    lat, lng, name, emergency, fromLat, fromLng, mode: modeParam,
    // Reservation context — only set on the siren auto-navigate path.
    // Used to render the SirenGroupPromptModal and to PATCH the existing
    // reservation when the user confirms a new group size.
    alertId, alertKind, shelterId, initialGroupSize: initialGroupSizeParam,
    // Suppresses the SirenGroupPromptModal auto-open. Set to "true" when
    // the user is being re-routed (e.g., changed transport mode) and has
    // already answered the count prompt earlier in the same alert.
    skipPrompt,
  } =
    useLocalSearchParams<{
      lat: string; lng: string; name: string; emergency?: string;
      // When the SimJoystick on the map was active, these carry the fake
      // start position so navigation begins from the simulated dot instead
      // of waiting for real GPS.
      fromLat?: string; fromLng?: string;
      // Optional transport-mode override. Settings stores `walking`, the
      // routing service uses `foot` — translated below.
      mode?: string;
      // Reservation context (siren-only).
      alertId?: string; alertKind?: string; shelterId?: string;
      initialGroupSize?: string;
      skipPrompt?: string;
    }>();
  const { user } = useAuth();

  const destLat = parseFloat(lat || '0');
  const destLng = parseFloat(lng || '0');
  const dest: Coord = { latitude: destLat, longitude: destLng };
  const isEmergency = emergency === 'true';
  // Resolve the initial transport mode from the URL. `walking` is the
  // settings-side label; the routing service knows it as `foot`.
  const initialMode: Mode =
    modeParam === 'walking' || modeParam === 'foot'    ? 'foot'    :
    modeParam === 'cycling'                            ? 'cycling' :
    modeParam === 'driving'                            ? 'driving' :
    'foot';

  // Whether we have enough reservation context to update the count from
  // this screen. Map screen passes these on the siren auto-navigate path.
  const reservationReady = !!(alertId && shelterId && user?.id);
  const initialReservationSize = (() => {
    const n = parseInt(initialGroupSizeParam || '1', 10);
    return Number.isFinite(n) && n >= 1 ? n : 1;
  })();
  // Pre-computed "from" override from the URL — null when not provided.
  const fromOverride: Coord | null =
    fromLat && fromLng
      ? { latitude: parseFloat(fromLat), longitude: parseFloat(fromLng) }
      : null;

  const webRef         = useRef<WebView>(null);
  const watchRef       = useRef<Location.LocationSubscription | null>(null);
  const stepsRef       = useRef<any[]>([]);
  const polylineRef    = useRef<Coord[]>([]);
  const modeRef        = useRef<Mode>(initialMode);
  const recalcCooldown = useRef(false);
  // Set once the arrival POST succeeds — used to (a) skip duplicate
  // /arrive calls if the geofence trips multiple times, and (b) suppress
  // the unmount-release (the user is physically there; we don't want
  // to undo their arrival).
  const arrivedRef     = useRef(false);
  // Guard against firing /arrive multiple times concurrently while the
  // first request is in flight.
  const arriveInFlight = useRef(false);
  // Tracks the most recent ETA in seconds so checkAlternativeNeeded can
  // compare against the zone's alert time without parsing the formatted label.
  const etaSecondsRef  = useRef(0);

  const [phase, setPhase]               = useState<'select' | 'navigating'>(
    isEmergency ? 'navigating' : 'select'
  );
  const [mode, setMode]                 = useState<Mode>(initialMode);
  // Seed userLocation immediately from the override so the background route
  // fetch (3 modes in parallel) starts right away instead of waiting on GPS.
  const [userLocation, setUserLocation] = useState<Coord | null>(fromOverride);
  const [steps, setSteps]               = useState<any[]>([]);
  const [currentStep, setCurrentStep]   = useState(0);
  const [eta, setEta]                   = useState('');
  const [currentDestName, setCurrentDestName] = useState(name || '');
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

  // SirenGroupPromptModal — opens automatically on emergency mount if we
  // have full reservation context AND the caller didn't ask to skip it.
  // `skipPrompt=true` is set when the user is being re-routed mid-alert
  // (e.g., changed transport mode) and has already answered once.
  const [groupPromptOpen, setGroupPromptOpen] = useState(
    isEmergency && reservationReady && skipPrompt !== 'true',
  );

  const [showAlternative, setShowAlternative]         = useState(false);
  const [alternativeBuilding, setAlternativeBuilding] = useState<{ address: string; entranceCode: string } | null>(null);
  const [codeVisible, setCodeVisible]                 = useState(true);

  const handleGroupSizeConfirm = useCallback(async (groupSize: number) => {
    setGroupPromptOpen(false);
    if (!reservationReady) return;
    try {
      await ReservationService.reserve({
        shelterId: shelterId!,
        userId:    user!.id,
        alertId:   alertId!,
        alertKind: (alertKind === 'early' ? 'early' : 'siren'),
        groupSize,
      });
    } catch (e) {
      // Reservation update is best-effort — the route is already loading
      // and the 1-person default reservation stands. Log but don't block.
      console.warn('[nav] reservation update failed:', e);
    }
  }, [reservationReady, shelterId, alertId, alertKind, user]);

  // Auto-release the reservation when the user backs out of the navigate
  // screen. Idempotent server-side, so it's safe to fire even when no
  // active reservation exists. Captures the IDs in locals so the cleanup
  // closure isn't recreated on every render.
  //
  // Deps are all primitives (user?.id, not user) so React's render-time
  // reference equality doesn't fire the cleanup mid-render.
  //
  // Ungated from `isEmergency` — pre-alarm reservations should also
  // release on back. Gated on `arrivedRef` instead: once the user has
  // physically arrived, the row is in actualOccupancy land and /release
  // is a no-op anyway, but skipping the call avoids a useless POST.
  const userId = user?.id;
  useEffect(() => {
    if (!reservationReady || !userId) return;
    const capturedShelterId = shelterId!;
    const capturedAlertId   = alertId!;
    return () => {
      if (arrivedRef.current) return;
      // Fire and forget — we're tearing down; no way to surface errors.
      ReservationService.release({
        shelterId: capturedShelterId,
        userId:    userId,
        alertId:   capturedAlertId,
      }).catch((e) => console.warn('[nav] release on unmount failed:', e));
    };
  }, [reservationReady, shelterId, alertId, userId]);

  // Try to promote the reservation to arrived if the user is within 10m
  // of the destination. Called from advanceOnRoute on every GPS / sim tick.
  // No-ops when reservation context is missing, the user has already
  // arrived, or another POST is in flight.
  const ARRIVAL_RADIUS_M = 10;
  const tryArrive = useCallback((pos: Coord) => {
    if (!reservationReady || !userId) return;
    if (arrivedRef.current || arriveInFlight.current) return;
    const dist = NavigationService.haversineM(pos, dest);
    if (dist > ARRIVAL_RADIUS_M) return;
    arriveInFlight.current = true;
    ReservationService.arrive({
      shelterId: shelterId!,
      userId,
      alertId:   alertId!,
    })
      .then(() => { arrivedRef.current = true; })
      .catch((e) => console.warn('[nav] arrive failed:', e))
      .finally(() => { arriveInFlight.current = false; });
  }, [reservationReady, userId, shelterId, alertId, dest]);

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
  // Uses the current `mode` (seeded from `?mode=` in the URL, or 'foot' by
  // default) so a siren auto-navigation honors the user's saved setting.
  useEffect(() => {
    if (!isEmergency || !userLocation) return;
    NavigationService.emergencyRoute(userLocation, dest, mode)
      .then(applyRoute)
      .catch(() => setError('Failed to load emergency route'))
      .finally(() => setLoading(false));
  }, [isEmergency, userLocation, mode]);

  // ─── Alternative shelter check ──────────────────────────────────────────
  const checkAlternativeNeeded = async () => {
    if (!userLocation) return;
    await OrefZonesService.load();
    const zone = OrefZonesService.getZone(userLocation.latitude, userLocation.longitude);
    const alertTime = getAlertTime(zone ?? '');
    console.log('[checkAlternativeNeeded]', {
      userLocation: { lat: userLocation.latitude, lng: userLocation.longitude },
      zone,
      alertTimeSec: alertTime,
      etaSeconds: etaSecondsRef.current,
    });
    if (etaSecondsRef.current > alertTime) {
      const res = await fetch(`${API_URL}/buildings/approved`);
      const json = await res.json();
      const approved = json.buildings || [];
      console.log('[checkAlternativeNeeded] buildings response:', json, 'approved:', approved);

      // The shelter just failed the time check — the building has to clear
      // the same gate, otherwise we'd reroute the user to a "fallback" that's
      // also unreachable. Filter first, then pick closest of the reachable.
      // If nothing's reachable, we leave alternativeBuilding=null and the
      // overlay falls through to mode-specific safety instructions.
      const reachable = approved
        .map((b: any) => ({
          b,
          distM: NavigationService.haversineM(
            userLocation,
            { latitude: b.lat, longitude: b.lng },
          ),
        }))
        .filter(({ distM }: { distM: number }) =>
          NavigationService.calculateETA(distM, modeRef.current) <= alertTime,
        )
        .sort((a: any, b: any) => a.distM - b.distM);

      const closest = reachable[0]?.b ?? null;
      setAlternativeBuilding(closest ? { address: closest.address, entranceCode: closest.entranceCode } : null);
      setShowAlternative(true);
      if (closest) {
        setCurrentDestName(closest.address);
        setTimeout(() => setCodeVisible(false), 5 * 60 * 1000);
        try {
          const altDest: Coord = { latitude: closest.lat, longitude: closest.lng };
          console.log('[checkAlternativeNeeded] calling emergencyRoute to:', altDest);
          const altRoute = await NavigationService.emergencyRoute(userLocation, altDest, modeRef.current);
          applyRoute(altRoute, true);
          console.log('[checkAlternativeNeeded] rerouted to building:', closest.address, closest.lat, closest.lng);
          setTimeout(() => sendToWeb({ type: 'setDestination', lat: closest.lat, lng: closest.lng }), 500);
        } catch (e) {
          console.warn('[checkAlternativeNeeded] reroute to alternative building failed:', e);
        }
      }
    }
  };

  // ─── Apply RouteResult to state ─────────────────────────────────────────
  function applyRoute(result: RouteResult, fromAlternative: boolean = false) {
    polylineRef.current = result.polyline;
    stepsRef.current    = result.steps;
    setSteps(result.steps);
    setCurrentStep(0);
    setEta(result.etaLabel);
    setDistance(result.distLabel);
    etaSecondsRef.current = result.durationSec;
    setPhase('navigating');
    if (alertKind === 'siren' && !fromAlternative) checkAlternativeNeeded();
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
    // Arrival check: if the user is within 10m of the destination during
    // an active alert reservation, promote the row to actualOccupancy.
    // Idempotent — tryArrive itself guards against double-firing.
    tryArrive(pos);

    if (stepsRef.current.length > 0) {
      setCurrentStep(NavigationService.nearestStepIndex(stepsRef.current, pos));
    }
    if (polylineRef.current.length > 0) {
      const { polyline: remaining, distanceM } =
        NavigationService.remainingRoute(polylineRef.current, pos);
      // Re-draw shrinking polyline as the user advances along the route
      pushRouteToMap(remaining);
      setDistance(NavigationService.formatDistance(distanceM));
      const etaSec = NavigationService.calculateETA(distanceM, modeRef.current);
      etaSecondsRef.current = etaSec;
      setEta(NavigationService.formatDuration(etaSec));

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
            <Text style={s.destName} numberOfLines={1}>{currentDestName || 'Shelter'}</Text>
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
          <Text style={s.destName} numberOfLines={1}>{currentDestName || 'Shelter'}</Text>
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

          {/* 🔑 entrance-code button — visible for 5 min after an alternative
              building is found. Reopens the altOverlay so the user can read
              the code again without dismissing their current view. */}
          {alternativeBuilding && codeVisible && (
            <TouchableOpacity
              style={s.codeBtn}
              onPress={() => setShowAlternative(true)}
              accessibilityLabel="Show entrance code"
            >
              <Text style={s.codeBtnIcon}>🔑</Text>
            </TouchableOpacity>
          )}

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

      {/* Siren popup — auto-opens once on emergency mount so the user
          can update the auto-reserved 1-person count with the actual
          group size they're with. Dismissing leaves the default in place. */}
      <SirenGroupPromptModal
        visible={groupPromptOpen}
        onConfirm={handleGroupSizeConfirm}
        onDismiss={() => setGroupPromptOpen(false)}
        initialGroupSize={initialReservationSize}
      />

      {/* Alternative shelter / safety instructions overlay */}
      {showAlternative && (
        <View style={s.altOverlay}>
          <View style={s.altCard}>
            <TouchableOpacity
              style={s.altClose}
              onPress={() => setShowAlternative(false)}
              accessibilityLabel="סגור"
            >
              <Text style={s.altCloseIcon}>✕</Text>
            </TouchableOpacity>

            {alternativeBuilding ? (
              <>
                <View style={s.altTitleBanner}>
                  <Text style={s.altTitle}>⚠️ אין מקלט בטווח</Text>
                </View>
                <Text style={s.altAddress}>{alternativeBuilding.address}</Text>
                {codeVisible ? (
                  <Text style={s.altCode}>קוד כניסה: {alternativeBuilding.entranceCode}</Text>
                ) : (
                  <Text style={s.altExpired}>פג תוקף הקוד</Text>
                )}
              </>
            ) : mode === 'driving' ? (
              <ScrollView>
                <Text style={s.altInstructions}>
                  עצרו בצד הדרך, צאו מהרכב והיכנסו למרחב המוגן המיטבי הקרוב ביותר. אם לא ניתן להגיע למבנה במהירות - צאו והתרחקו מהרכב מעבר לשולי הדרך או למעקה הבטיחות, שכבו על הקרקע והגנו על הראש עם הידיים. רק אם לא ניתן לצאת מהרכב - עצרו בצד הדרך, פתחו את החלונות והתכופפו מתחת לקו החלונות.
                </Text>
              </ScrollView>
            ) : (
              <Text style={s.altInstructions}>שכבו על הקרקע והגנו על הראש עם הידיים.</Text>
            )}
          </View>
        </View>
      )}
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
  // 🔑 entrance-code shortcut — stacked above the sim toggle.
  codeBtn: {
    position: 'absolute', bottom: 136, right: 16,
    backgroundColor: '#fff', borderRadius: 24, width: 48, height: 48,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25, shadowRadius: 4, elevation: 5,
    zIndex: 10,
  },
  codeBtnIcon: { fontSize: 22 },
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
  // Alternative shelter overlay
  altOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.65)',
    zIndex: 999,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  altCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    overflow: 'hidden',
    width: '100%',
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  altTitleBanner: {
    backgroundColor: '#e53935',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  altClose:        { alignSelf: 'flex-end', padding: 12, marginBottom: 0 },
  altCloseIcon:    { fontSize: 18, color: '#555' },
  altTitle:        { fontSize: 20, fontWeight: '800', color: '#fff', textAlign: 'right' },
  altAddress:      { fontSize: 16, color: '#666', textAlign: 'right', marginTop: 16, marginHorizontal: 20 },
  altCode:         { fontSize: 26, fontWeight: '800', color: '#1a73e8', textAlign: 'right', marginTop: 12, marginHorizontal: 20, marginBottom: 20 },
  altExpired:      { fontSize: 14, color: '#999', textAlign: 'right', marginTop: 12, marginHorizontal: 20, marginBottom: 20 },
  altInstructions: { fontSize: 15, color: '#333', textAlign: 'right', lineHeight: 24, margin: 20 },
  // HUD
  hud:              { backgroundColor: '#1a73e8', paddingHorizontal: 20, paddingVertical: 16, minHeight: 80, justifyContent: 'center' },
  hudArrived:       { backgroundColor: '#1D9E75' },
  hudEmergency:     { backgroundColor: '#e53935' },
  hudStep:          { fontSize: 18, fontWeight: '700', color: '#fff', textAlign: 'left' },
  hudNext:          { fontSize: 13, color: '#ffffffaa', marginTop: 6, textAlign: 'left' },
  hudError:         { fontSize: 16, color: '#fff', textAlign: 'center' },
});
