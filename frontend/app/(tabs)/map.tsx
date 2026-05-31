import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  View,
  StyleSheet,
  Text,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  TextInput,
  DeviceEventEmitter,
} from "react-native";
import { WebView } from "react-native-webview";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@/context/auth";
import { AlertsService, type Alert as PikudAlert } from "@/services/AlertsService";
import { OrefZonesService } from "@/services/OrefZonesService";
import SimJoystick from "@/components/SimJoystick";
import AlertBanner from "@/components/AlertBanner";
import AlertInjectModal from "@/components/AlertInjectModal";
import NearbyShelterSheet from "@/components/NearbyShelterSheet";
import SirenModeSheet, { type SettingsMode } from "@/components/SirenModeSheet";
import { SHELTER_STATUS_COLORS } from "@/constants/shelterStatus";
import { GEOFENCE_SETTINGS_CHANGED_EVENT } from "@/hooks/use-home-geofence";
import { NavigationService } from "@/services/NavigationService";

const API_URL = process.env.EXPO_PUBLIC_API_URL;

type Pin = { latitude: number; longitude: number; name: string };
type ShelterPin = {
  id: string;
  latitude: number;
  longitude: number;
  name: string;
  address: string;
  neighborhood?: string;
  area?: string;        // mapped from ShelterTest.alertZone if present
  city?: string;
  placeType?: string;
  capacity?: number;
  accessStatus?: string;
  isFull?: boolean;
  isAccessible?: boolean;
  hasStairs?: boolean;
  petIssueReported?: boolean;
  cleanlinessStatus?: string;
  shouldBeOpen?: boolean;
  lastReportAt?: string;
  lastReportType?: string;
  // Admin flags — when `false`, the shelter is hidden from the map entirely.
  // `undefined` is treated as "no opinion" → still shown (back-compat).
  isActive?: boolean;
  isVisibleOnMap?: boolean;
};

// Build the query string for /shelter-details — all values become strings.
function shelterParams(s: ShelterPin): string {
  const parts: string[] = [];
  const add = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === '') return;
    parts.push(`${k}=${encodeURIComponent(String(v))}`);
  };
  add('id', s.id);
  add('lat', s.latitude);
  add('lng', s.longitude);
  add('name', s.name);
  add('address', s.address);
  add('neighborhood', s.neighborhood);
  add('area', s.area);
  add('city', s.city);
  add('placeType', s.placeType);
  add('capacity', s.capacity);
  add('accessStatus', s.accessStatus);
  add('isFull', s.isFull);
  add('isAccessible', s.isAccessible);
  add('hasStairs', s.hasStairs);
  add('petIssueReported', s.petIssueReported);
  add('cleanlinessStatus', s.cleanlinessStatus);
  add('shouldBeOpen', s.shouldBeOpen);
  add('lastReportAt', s.lastReportAt);
  add('lastReportType', s.lastReportType);
  return parts.join('&');
}

export function getShelterColor(shelter: ShelterPin): string {
  if (
    shelter.accessStatus === "closed" ||
    shelter.accessStatus === "locked" ||
    shelter.shouldBeOpen === false
  ) {
    return SHELTER_STATUS_COLORS.closed;
  }
  if (shelter.isFull) {
    return SHELTER_STATUS_COLORS.full;
  }
  return SHELTER_STATUS_COLORS.open;
}

// ── Leaflet map HTML ─────────────────────────────────────────────────
// Self-contained map runtime that lives inside the WebView. Communicates
// with React Native via window.ReactNativeWebView.postMessage (out) and
// window/document 'message' listeners (in).
const MAP_HTML = `<!DOCTYPE html><html lang="he"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"></script>
<style>
  html,body,#map { margin:0; padding:0; width:100vw; height:100vh; }
  .user-dot {
    width:18px;height:18px;border-radius:9px;background:#1a73e8;
    border:3px solid #fff;box-shadow:0 0 6px rgba(0,0,0,.4);
  }
  .search-pin {
    width:22px;height:22px;border-radius:50% 50% 50% 0;
    background:#1a73e8;border:2px solid #fff;
    transform:rotate(-45deg);box-shadow:0 0 4px rgba(0,0,0,.4);
  }
</style></head><body>
<div id="map"></div>
<script>
  var map = L.map('map', { zoomControl:false }).setView([31.5, 34.8], 8);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);

  var clusters = L.markerClusterGroup({
    chunkedLoading: true,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    maxClusterRadius: 50,
  });
  map.addLayer(clusters);

  var userMarker = null;
  var searchMarker = null;
  var homeCircle = null;

  function send(obj) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(obj));
    }
  }

  map.on('click', function(e) {
    send({ type:'mapClick', lat:e.latlng.lat, lng:e.latlng.lng });
  });

  function handle(raw) {
    var msg;
    try { msg = JSON.parse(raw); } catch(_) { return; }

    if (msg.type === 'setShelters') {
      clusters.clearLayers();
      var markers = [];
      for (var i = 0; i < msg.data.length; i++) {
        var s = msg.data[i];
        var color = s.color || '#BA7517';
        var icon = L.divIcon({
          html: '<div style="width:26px;height:26px;border-radius:50%;background:' + color + ';border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font-size:13px;">🏠</div>',
          iconSize: [26, 26],
          className: '',
        });
        var m = L.marker([s.lat, s.lng], { icon: icon });
        (function(id) {
          m.on('click', function(e) {
            L.DomEvent.stopPropagation(e);
            send({ type:'shelterClick', id: id });
          });
        })(s.id);
        markers.push(m);
      }
      clusters.addLayers(markers);
    }

    else if (msg.type === 'setUserLocation') {
      var ll = [msg.lat, msg.lng];
      if (userMarker) { userMarker.setLatLng(ll); }
      else {
        userMarker = L.marker(ll, {
          icon: L.divIcon({ className:'', html:'<div class="user-dot"></div>', iconSize:[18,18] }),
          interactive: false,
        }).addTo(map);
      }
    }

    else if (msg.type === 'flyTo') {
      // Honor msg.duration — sim updates pass 0 for instant pan so rapid
      // ticks don't stack overlapping animations and feel laggy.
      var dur = typeof msg.duration === 'number' ? msg.duration : 0.5;
      map.setView([msg.lat, msg.lng], msg.zoom || 16,
        dur === 0 ? { animate: false } : { animate: true, duration: dur });
    }

    else if (msg.type === 'setSearchPin') {
      if (searchMarker) { map.removeLayer(searchMarker); searchMarker = null; }
      if (msg.data) {
        searchMarker = L.marker([msg.data.lat, msg.data.lng], {
          icon: L.divIcon({ className:'', html:'<div class="search-pin"></div>', iconSize:[22,22], iconAnchor:[11,22] }),
        }).addTo(map);
      }
    }

    else if (msg.type === 'setHomeCircle') {
      // Remove the previous circle (if any) so the radius can be updated.
      if (homeCircle) { map.removeLayer(homeCircle); homeCircle = null; }
      if (msg.data) {
        homeCircle = L.circle([msg.data.lat, msg.data.lng], {
          radius: msg.data.radius,
          color: 'rgba(26,115,232,0.7)',
          weight: 2,
          fillColor: 'rgba(26,115,232,1)',
          fillOpacity: 0.15,
          interactive: false,
        }).addTo(map);
      }
    }
  }

  // iOS uses 'message' on window; Android often on document. Listen to both.
  window.addEventListener('message', function(e) { handle(e.data); });
  document.addEventListener('message', function(e) { handle(e.data); });

  // Notify RN that the map runtime is ready to receive data
  send({ type:'ready' });
</script>
</body></html>`;

export default function MapScreen() {
  const { user } = useAuth();
  const webRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [locationGranted, setLocationGranted] = useState(false);
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [pin, setPin] = useState<Pin | null>(null);
  const [shelterPins, setShelterPins] = useState<ShelterPin[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [webReady, setWebReady] = useState(false);
  // Home "do not notify" circle — loaded from settings (AsyncStorage)
  const [home, setHome] = useState<{ lat: number; lng: number; radius: number } | null>(null);
  // Pikud HaOref alert state — banner + demo injection modal
  const [activeAlert, setActiveAlert] = useState<PikudAlert | null>(null);
  const [alertInjectOpen, setAlertInjectOpen] = useState(false);
  // Banner-tap action sheets — one for each alert kind. At most one is open
  // at a time (we just track them separately to keep the conditional simple).
  const [nearbySheetOpen, setNearbySheetOpen] = useState(false);
  const [sirenSheetOpen,  setSirenSheetOpen]  = useState(false);
  // Last shelter the siren auto-route picked. Stored so the SirenModeSheet
  // knows where to re-route when the user changes transport mode.
  const lastAutoTargetRef = useRef<ShelterPin | null>(null);
  // User's saved transport mode (from Settings → AsyncStorage). Reloaded on
  // focus so a fresh change is picked up next time a siren fires.
  const [savedMode, setSavedMode] = useState<SettingsMode>('walking');
  // Dedupe so a single siren alert doesn't auto-navigate twice — even if
  // the same alert id re-emits (it shouldn't, but be defensive).
  const sirenHandledIdRef = useRef<string | null>(null);
  // Tracks whether the official Pikud HaOref polygons finished loading.
  // We use this to re-evaluate `userZone` once the data is available.
  const [polygonsReady, setPolygonsReady] = useState(false);

  // ─── SimJoystick state — fake GPS for demos / QA ─────────────────────────
  const [simOn, setSimOn]         = useState(false);
  const [simCoords, setSimCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const moveIntent = useRef({ dx: 0, dy: 0 });
  const lastMoveAt = useRef(0);

  // Subscribe to alerts (polling oref.org.il every 3s) for the lifetime of
  // the map screen. The same hook also receives manual injections fired by
  // the demo modal — both paths funnel into `setActiveAlert`.
  useEffect(() => {
    return AlertsService.subscribe(setActiveAlert);
  }, []);

  // Load the official Pikud HaOref polygons once. `OrefZonesService.load`
  // is idempotent so calling it on every mount is safe.
  useEffect(() => {
    OrefZonesService.load().then(() => setPolygonsReady(true));
  }, []);

  // Resolve the user's Pikud HaOref zone. Order of preference:
  //   1. The official polygon containing the user's coordinates.
  //   2. The nearest shelter's `area` (`alertZone`) — coarse but workable
  //      when polygons are not yet loaded or the user is just outside any
  //      polygon (e.g. on a road boundary).
  //   3. Plain "באר שבע" as a last-resort string.
  //
  // While the sim is on, we follow the simulated dot — that's what the
  // user actually sees on the map, and what should drive any zone-based
  // alerting in demos. The real GPS resumes when sim is off.
  const userZone = useMemo(() => {
    const pos = simOn ? simCoords : userLocation;
    if (!pos) return 'באר שבע';
    if (polygonsReady) {
      const zone = OrefZonesService.getZone(pos.latitude, pos.longitude);
      if (zone) return zone;
    }
    let best: string | undefined;
    let bestDist = Infinity;
    for (const sh of shelterPins) {
      if (!sh.area) continue;
      const dLat = sh.latitude  - pos.latitude;
      const dLng = sh.longitude - pos.longitude;
      const d = dLat * dLat + dLng * dLng;
      if (d < bestDist) { bestDist = d; best = sh.area; }
    }
    return best ?? 'באר שבע';
  }, [simOn, simCoords, userLocation, shelterPins, polygonsReady]);


  // Helper — send a JSON message into the WebView
  const sendToWeb = useCallback((obj: any) => {
    webRef.current?.postMessage(JSON.stringify(obj));
  }, []);

  // Append the sim coords as `fromLat`/`fromLng` so the downstream screens
  // (shelter-details → navigate) know to start the route from the simulated
  // position instead of real GPS. Empty string when sim is off.
  const fromSuffix = (): string => {
    if (!simOn || !simCoords) return '';
    return `&fromLat=${simCoords.latitude}&fromLng=${simCoords.longitude}`;
  };

  const openShelter = useCallback((sh: ShelterPin) => {
    const suffix = (!simOn || !simCoords)
      ? ''
      : `&fromLat=${simCoords.latitude}&fromLng=${simCoords.longitude}`;
    router.push(`/shelter-details?${shelterParams(sh)}${suffix}` as any);
  }, [simOn, simCoords]);

  // ── Alert handling — banner taps + siren auto-navigate ──────────────────
  // Kept together here, after `openShelter`, because `handleNearbyPick`
  // delegates to it for the regular (mode-select) navigation flow.

  // Pick the closest usable shelter to the current (real or simulated)
  // position. "Usable" = not closed/locked and not admin-hidden. Full
  // shelters are kept — the user in a siren still needs *somewhere* to go.
  const findNearestUsableShelter = useCallback((): ShelterPin | null => {
    const pos = simOn ? simCoords : userLocation;
    if (!pos || shelterPins.length === 0) return null;
    let best: ShelterPin | null = null;
    let bestDist = Infinity;
    for (const sh of shelterPins) {
      if (sh.accessStatus === 'closed' || sh.accessStatus === 'locked') continue;
      if (sh.shouldBeOpen === false) continue;
      const d = NavigationService.haversineM(
        { latitude: pos.latitude, longitude: pos.longitude },
        { latitude: sh.latitude, longitude: sh.longitude },
      );
      if (d < bestDist) { bestDist = d; best = sh; }
    }
    return best;
  }, [simOn, simCoords, userLocation, shelterPins]);

  // Push the navigate screen with the siren auto-route params. Pulled out
  // so both the initial siren effect and the SirenModeSheet ("change mode")
  // call into the same code path.
  const pushSirenNavigate = useCallback((target: ShelterPin, mode: SettingsMode) => {
    const suffix = (!simOn || !simCoords)
      ? ''
      : `&fromLat=${simCoords.latitude}&fromLng=${simCoords.longitude}`;
    const params =
      `lat=${target.latitude}` +
      `&lng=${target.longitude}` +
      `&name=${encodeURIComponent(target.name || 'מקלט')}` +
      `&emergency=true` +
      `&mode=${mode}` +
      suffix;
    router.push(`/navigate?${params}` as any);
  }, [simOn, simCoords]);

  // Siren → auto-navigate immediately to the nearest usable shelter using
  // the user's saved transport mode (defaults to walking). Dedupes per
  // alert id so a single event never triggers two navigations.
  useEffect(() => {
    if (!activeAlert || activeAlert.kind !== 'siren') return;
    if (sirenHandledIdRef.current === activeAlert.id) return;
    const target = findNearestUsableShelter();
    if (!target) return;  // no shelter known yet — banner is still up; user can pick manually
    sirenHandledIdRef.current = activeAlert.id;
    lastAutoTargetRef.current = target;
    pushSirenNavigate(target, savedMode);
  }, [activeAlert, savedMode, findNearestUsableShelter, pushSirenNavigate]);

  // Banner tap → open the right sheet for the current alert kind.
  const handleBannerPress = useCallback(() => {
    if (!activeAlert) return;
    if (activeAlert.kind === 'early') setNearbySheetOpen(true);
    else                              setSirenSheetOpen(true);
  }, [activeAlert]);

  // Pre-alarm sheet → user picked a shelter. Navigate the regular (non-
  // emergency) way so the user still gets to choose transport mode.
  const handleNearbyPick = useCallback((sh: { id: string }) => {
    setNearbySheetOpen(false);
    const full = shelterPins.find(p => p.id === sh.id);
    if (full) openShelter(full);
  }, [shelterPins, openShelter]);

  // Siren sheet → user changed transport mode. Re-route to the same target
  // the siren originally picked (cached in `lastAutoTargetRef`). We use
  // router.push (not replace) because the user is currently on the map —
  // there's no existing navigate screen on top to replace.
  const handleSirenModePick = useCallback((mode: SettingsMode) => {
    setSirenSheetOpen(false);
    const target = lastAutoTargetRef.current ?? findNearestUsableShelter();
    if (!target) return;
    pushSirenNavigate(target, mode);
  }, [findNearestUsableShelter, pushSirenNavigate]);

  // Load shelters from the API
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/shelters`);
        const data = await res.json();
        const shelters = data.shelters || [];

        const pins: ShelterPin[] = [];
        for (const sh of shelters) {
          const lat = sh.lat ?? sh.latitude;
          const lng = sh.lng ?? sh.longitude;
          // Admins can flag a shelter as `isActive=false` (no longer exists)
          // or `isVisibleOnMap=false` (hidden from public view). Skip both.
          // Undefined values are kept (back-compat with older records).
          if (sh.isActive === false || sh.isVisibleOnMap === false) {
            continue;
          }
          if (typeof lat === "number" && typeof lng === "number" && lat !== 0) {
            pins.push({
              id: sh.id ?? sh._id ?? `${lat}-${lng}-${sh.name}`,
              latitude: lat,
              longitude: lng,
              name: sh.name || "",
              address: sh.address || "",
              neighborhood: sh.neighborhood,
              // ShelterTest stores the area as `alertZone`; fall back to it so
              // the Area row in shelter-details is populated correctly.
              area: sh.area ?? sh.alertZone,
              city: sh.city,
              placeType: sh.placeType,
              capacity: sh.capacity,
              accessStatus: sh.accessStatus,
              isFull: sh.isFull,
              isAccessible: sh.isAccessible,
              hasStairs: sh.hasStairs,
              petIssueReported: sh.petIssueReported,
              cleanlinessStatus: sh.cleanlinessStatus,
              shouldBeOpen: sh.shouldBeOpen,
              lastReportAt: sh.lastReportAt,
              lastReportType: sh.lastReportType,
              isActive: sh.isActive,
              isVisibleOnMap: sh.isVisibleOnMap,
            });
          }
        }
        setShelterPins(pins);
      } catch (e) {
        console.error("Failed to load shelters:", e);
      }
    })();
  }, []);

  // Reload home settings every time the map gains focus, so the circle
  // reflects whatever the user most recently saved in Settings.
  // We also pick up the saved transport mode here so the siren auto-route
  // honors the latest preference without needing a restart.
  useFocusEffect(
    useCallback(() => {
      (async () => {
        try {
          const saved = await AsyncStorage.getItem("userSettings");
          if (!saved) { setHome(null); setSavedMode('walking'); return; }
          const p = JSON.parse(saved);
          const lat = typeof p.homeLat === "number" ? p.homeLat : null;
          const lng = typeof p.homeLng === "number" ? p.homeLng : null;
          const radius = parseFloat(p.radius);
          if (lat != null && lng != null && !isNaN(radius) && radius > 0) {
            setHome({ lat, lng, radius });
          } else {
            setHome(null);
          }
          const m = p.transportMode;
          setSavedMode(
            m === 'cycling' || m === 'driving' ? m : 'walking'
          );
        } catch {
          setHome(null);
          setSavedMode('walking');
        }
      })();
    }, []),
  );

  // Get user location once permission is granted
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const loc = await Location.getCurrentPositionAsync({});
        setUserLocation({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
        setLocationGranted(true);
      }
      setLoading(false);
    })();
  }, []);

  // ── Sync data → WebView whenever it (or the data) changes ─────────────

  useEffect(() => {
    if (!webReady || shelterPins.length === 0) return;
    const data = shelterPins.map(s => ({
      id: s.id, lat: s.latitude, lng: s.longitude, color: getShelterColor(s),
    }));
    sendToWeb({ type: 'setShelters', data });
  }, [webReady, shelterPins, sendToWeb]);

  useEffect(() => {
    if (!webReady || !userLocation) return;
    sendToWeb({
      type: 'setUserLocation',
      lat: userLocation.latitude,
      lng: userLocation.longitude,
    });
    sendToWeb({
      type: 'flyTo',
      lat: userLocation.latitude,
      lng: userLocation.longitude,
      zoom: 14,
    });
  }, [webReady, userLocation, sendToWeb]);

  useEffect(() => {
    if (!webReady) return;
    sendToWeb({
      type: 'setSearchPin',
      data: pin ? { lat: pin.latitude, lng: pin.longitude } : null,
    });
  }, [webReady, pin, sendToWeb]);

  // Home "do not notify" circle — push to Leaflet whenever it changes
  useEffect(() => {
    if (!webReady) return;
    sendToWeb({
      type: 'setHomeCircle',
      data: home ? { lat: home.lat, lng: home.lng, radius: home.radius } : null,
    });
  }, [webReady, home, sendToWeb]);

  // ── Handle messages coming back from the WebView ──────────────────────
  const handleWebMessage = useCallback(async (event: any) => {
    let msg: any;
    try { msg = JSON.parse(event.nativeEvent.data); } catch { return; }

    if (msg.type === 'ready') {
      setWebReady(true);
      return;
    }

    if (msg.type === 'shelterClick') {
      const found = shelterPins.find(s => s.id === msg.id);
      if (found) {
        setPin(null);
        openShelter(found);
      }
      return;
    }

    if (msg.type === 'mapClick') {
      const { lat, lng } = msg;
      setPin({ latitude: lat, longitude: lng, name: "Loading address..." });
      try {
        const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
        if (results.length > 0) {
          const r = results[0];
          const street = [r.street, r.streetNumber].filter(Boolean).join(" ");
          const city = r.city || r.subregion || r.region || "";
          const address =
            [street, city].filter(Boolean).join(", ") ||
            `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
          setPin({ latitude: lat, longitude: lng, name: address });
        } else {
          setPin({ latitude: lat, longitude: lng, name: `${lat.toFixed(5)}, ${lng.toFixed(5)}` });
        }
      } catch {
        setPin({ latitude: lat, longitude: lng, name: `${lat.toFixed(5)}, ${lng.toFixed(5)}` });
      }
    }
  }, [shelterPins, openShelter]);

  // ─── SimJoystick — fake GPS movement for demos / QA ─────────────────────
  // Same pattern as navigate.tsx but with a bigger STEP so it's noticeably
  // faster on the main map (good for "fly across the city" exploration).
  // The deadman switch (`lastMoveAt`) guards against iOS missing the
  // PanResponder release event.
  const handleJoyMove = (dx: number, dy: number) => {
    lastMoveAt.current = Date.now();
    moveIntent.current = { dx, dy };
  };
  const handleJoyStop = () => {
    moveIntent.current = { dx: 0, dy: 0 };
  };

  useEffect(() => {
    if (!simOn) return;
    const SIM_TICK_MS   = 100;       // 10 updates/sec
    const STEP          = 0.0001;    // ≈11m per fully-pushed tick — fast
    const STALE_MOVE_MS = 250;
    const id = setInterval(() => {
      if (Date.now() - lastMoveAt.current > STALE_MOVE_MS) {
        moveIntent.current = { dx: 0, dy: 0 };
        return;
      }
      const { dx, dy } = moveIntent.current;
      if (dx === 0 && dy === 0) return;
      setSimCoords(prev => {
        const base = prev ?? userLocation ?? { latitude: 31.25, longitude: 34.79 };
        return {
          latitude:  base.latitude  - dy * STEP, // up on screen = north
          longitude: base.longitude + dx * STEP,
        };
      });
    }, SIM_TICK_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simOn]);

  // Push sim location to the map. duration: 0 → instant pan, no animation
  // overlap between the 100ms ticks.
  useEffect(() => {
    if (!simOn || !simCoords || !webReady) return;
    sendToWeb({ type: 'setUserLocation', lat: simCoords.latitude, lng: simCoords.longitude });
    sendToWeb({ type: 'flyTo', lat: simCoords.latitude, lng: simCoords.longitude, zoom: 16, duration: 0 });
  }, [simOn, simCoords, webReady, sendToWeb]);

  const toggleSim = () => {
    if (simOn) {
      setSimOn(false);
      setSimCoords(null);
      moveIntent.current = { dx: 0, dy: 0 };
      return;
    }
    const seed = userLocation ?? { latitude: 31.25, longitude: 34.79 };
    setSimCoords(seed);
    setSimOn(true);
    if (webReady) {
      sendToWeb({ type: 'flyTo', lat: seed.latitude, lng: seed.longitude, zoom: 17 });
    }
  };

  // 📍 button — fly the map to the user (real or simulated)
  const focusOnUser = () => {
    const target = simOn ? simCoords : userLocation;
    if (!target) return;
    sendToWeb({
      type: 'flyTo',
      lat: target.latitude,
      lng: target.longitude,
      zoom: 16,
    });
  };

  // ⚙️ button — open the Settings screen (includes Logout etc.)
  const openSettings = () => {
    router.push('/(tabs)/settings' as any);
  };

  // ── Address search — first tries shelter names, then Nominatim ──────
  const searchAddress = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    setPin(null);

    const lower = q.toLowerCase();
    const matched = shelterPins.find(sh =>
      sh.name.toLowerCase().includes(lower) ||
      (sh.address && sh.address.toLowerCase().includes(lower))
    );
    if (matched) {
      sendToWeb({ type: 'flyTo', lat: matched.latitude, lng: matched.longitude, zoom: 17 });
      openShelter(matched);
      setSearching(false);
      return;
    }

    try {
      const locationBias = userLocation
        ? `&viewbox=${userLocation.longitude - 0.1},${userLocation.latitude + 0.1},${userLocation.longitude + 0.1},${userLocation.latitude - 0.1}&bounded=0`
        : '';
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=il${locationBias}`,
        { headers: { 'Accept-Language': 'he' } }
      );
      const data = await res.json();
      if (data.length > 0) {
        const { lat, lon, display_name } = data[0];
        const latitude = parseFloat(lat);
        const longitude = parseFloat(lon);
        sendToWeb({ type: 'flyTo', lat: latitude, lng: longitude, zoom: 16 });
        setPin({ latitude, longitude, name: display_name });
      }
    } catch (e) {
      console.warn('Search failed:', e);
    } finally {
      setSearching(false);
    }
  }, [searchQuery, userLocation, shelterPins, sendToWeb, openShelter]);

  const navigateToPin = () => {
    if (!pin) return;
    router.push(
      `/navigate?lat=${pin.latitude}&lng=${pin.longitude}&name=${encodeURIComponent(pin.name)}${fromSuffix()}`,
    );
  };

  // Save the currently-tapped pin as the user's home address. Merges with
  // whatever is already in `userSettings` so we don't blow away radius / mode.
  const setPinAsHome = async () => {
    if (!pin) return;
    Alert.alert(
      "Set as Home",
      `Use this location as your home address?\n\n${pin.name}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          onPress: async () => {
            try {
              const saved = await AsyncStorage.getItem("userSettings");
              const prev = saved ? JSON.parse(saved) : {};
              const next = {
                ...prev,
                address: pin.name,
                homeLat: pin.latitude,
                homeLng: pin.longitude,
              };
              await AsyncStorage.setItem("userSettings", JSON.stringify(next));

              // Re-arm the geofence with the new home immediately.
              DeviceEventEmitter.emit(GEOFENCE_SETTINGS_CHANGED_EVENT);

              // Sync to backend (best-effort — local copy is the source of truth here)
              if (API_URL && user?.id) {
                fetch(`${API_URL}/api/settings`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    user_id: user.id,
                    address: pin.name,
                    home_lat: pin.latitude,
                    home_lng: pin.longitude,
                    exclusion_radius: parseFloat(prev.radius) || 0,
                    transport_mode: prev.transportMode || "walking",
                    is_handicapped: !!prev.isHandicapped,
                  }),
                }).catch(() => {});
              }

              // Refresh the on-map circle immediately. Only show it if a
              // positive radius is already configured.
              const radius = parseFloat(prev.radius);
              if (!isNaN(radius) && radius > 0) {
                setHome({ lat: pin.latitude, lng: pin.longitude, radius });
                Alert.alert("Home set", "Your home address has been updated.");
              } else {
                setHome(null);
                Alert.alert(
                  "Home set",
                  "Open Settings to set a 'Do Not Notify' radius so the circle appears on the map.",
                );
              }

              setPin(null);
            } catch {
              Alert.alert("Error", "Could not save home address.");
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1a73e8" />
        <Text style={styles.loadingText}>Locating...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Map (Leaflet inside a WebView — bypasses Apple Maps memory issues) */}
      <WebView
        ref={webRef}
        style={styles.map}
        source={{ html: MAP_HTML }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        onMessage={handleWebMessage}
        testID="map-webview"
      />

      {/* Search bar */}
      <View style={styles.searchBar} testID="search-bar">
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search address..."
          placeholderTextColor="#999"
          returnKeyType="search"
          onSubmitEditing={searchAddress}
          testID="search-input"
        />
        {searchQuery.length > 0 && !searching && (
          <TouchableOpacity onPress={() => { setSearchQuery(''); setPin(null); }} style={styles.searchClear} testID="search-clear">
            <Text style={styles.searchClearText}>✕</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.searchBtn} onPress={searchAddress} disabled={searching} testID="search-button">
          {searching
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.searchBtnText}>🔍</Text>}
        </TouchableOpacity>
      </View>

      {/* Map legend */}
      <View style={styles.legend}>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: SHELTER_STATUS_COLORS.open }]} />
          <Text style={styles.legendLabel}>פתוח</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: SHELTER_STATUS_COLORS.full }]} />
          <Text style={styles.legendLabel}>מלא</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: SHELTER_STATUS_COLORS.closed }]} />
          <Text style={styles.legendLabel}>סגור / נעול</Text>
        </View>
      </View>

      <TouchableOpacity
        style={styles.gearButton}
        onPress={openSettings}
        testID="gear-button"
        accessibilityLabel="Open settings"
      >
        <Text style={styles.gearIcon}>⚙️</Text>
      </TouchableOpacity>

      {/* 🚨 demo-alert button — opens a modal that lets the user simulate
          either an early-warning or an actual siren so the banner can be
          demonstrated without waiting for a real attack. */}
      <TouchableOpacity
        style={styles.demoAlertButton}
        onPress={() => setAlertInjectOpen(true)}
        testID="demo-alert-btn"
        accessibilityLabel="Simulate an alert"
      >
        <Text style={styles.demoAlertIcon}>🚨</Text>
      </TouchableOpacity>

      {/* 💬 chat shortcut — opens the psychology assistant chatbot. */}
      <TouchableOpacity
        style={styles.chatFab}
        onPress={() => router.push('/chat' as any)}
        testID="chat-fab"
        accessibilityLabel="Open chat assistant"
      >
        <Text style={styles.chatFabIcon}>💬</Text>
      </TouchableOpacity>

      {/* Location button */}
      {locationGranted && (
        <TouchableOpacity
          style={[
            styles.locationButton,
            pin ? styles.locationButtonWithPanel : null,
          ]}
          onPress={focusOnUser}
        >
          <Text style={styles.locationIcon}>📍</Text>
        </TouchableOpacity>
      )}

      {/* Sim joystick toggle — bottom-right, just above 📍.
          Hidden by default; tap 👁️ to reveal the joystick for fake GPS. */}
      <TouchableOpacity
        style={styles.simToggle}
        onPress={toggleSim}
        testID="sim-toggle"
        accessibilityLabel="Toggle sim joystick"
      >
        <Text style={styles.simToggleIcon}>{simOn ? '🎮' : '👁️'}</Text>
      </TouchableOpacity>

      {/* Joystick itself — only mounted when the sim is on, sits above
          the toggle so the user can keep their thumb in the corner. */}
      {simOn && (
        <View style={styles.simJoyWrap} pointerEvents="box-none">
          <SimJoystick onMove={handleJoyMove} onStop={handleJoyStop} />
        </View>
      )}

      {/* Bottom panel for arbitrary map tap (non-shelter point) */}
      {pin && (
        <View style={styles.panel}>
          <TouchableOpacity
            style={styles.panelClose}
            onPress={() => setPin(null)}
          >
            <Text style={styles.panelCloseText}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.panelName} numberOfLines={2}>
            {pin.name}
          </Text>
          <View style={styles.panelActions}>
            <TouchableOpacity
              style={[styles.navBtn, styles.panelActionsBtn]}
              onPress={navigateToPin}
            >
              <Text style={styles.navBtnText}>🧭 Navigate</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.homeBtn, styles.panelActionsBtn]}
              onPress={setPinAsHome}
            >
              <Text style={styles.homeBtnText}>🏠 Set as Home</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Pikud HaOref alert — banner overlay + demo injection modal */}
      <AlertBanner
        alert={activeAlert}
        onDismiss={() => setActiveAlert(null)}
        onPress={handleBannerPress}
      />
      <AlertInjectModal
        visible={alertInjectOpen}
        onClose={() => setAlertInjectOpen(false)}
        area={userZone}
      />

      {/* Pre-alarm sheet — list of nearby open shelters */}
      <NearbyShelterSheet
        visible={nearbySheetOpen}
        onClose={() => setNearbySheetOpen(false)}
        onPick={handleNearbyPick}
        shelters={shelterPins}
        userLocation={
          simOn && simCoords
            ? { latitude: simCoords.latitude, longitude: simCoords.longitude }
            : userLocation
              ? { latitude: userLocation.latitude, longitude: userLocation.longitude }
              : null
        }
      />

      {/* Siren sheet — change transport mode mid-route */}
      <SirenModeSheet
        visible={sirenSheetOpen}
        onClose={() => setSirenSheetOpen(false)}
        onPick={handleSirenModePick}
        currentMode={savedMode}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },

  searchBar: {
    position: 'absolute',
    top: 54,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 6,
    zIndex: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#222',
    paddingVertical: 6,
  },
  searchClear: { paddingHorizontal: 8 },
  searchClearText: { fontSize: 15, color: '#aaa' },
  searchBtn: {
    backgroundColor: '#1a73e8',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginLeft: 6,
  },
  searchBtnText: { fontSize: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  loadingText: { marginTop: 12, color: "#666" },

  // ⚙️ shortcut — top-left, just under the search bar.
  gearButton: {
    position: 'absolute',
    top: 110,
    left: 12,
    backgroundColor: '#fff',
    borderRadius: 24,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
    zIndex: 10,
  },
  gearIcon: { fontSize: 20 },

  // 🚨 demo-alert button — sits just under the gear, same left column.
  demoAlertButton: {
    position: 'absolute',
    top: 162,
    left: 12,
    backgroundColor: '#fff',
    borderRadius: 24,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
    zIndex: 10,
  },
  demoAlertIcon: { fontSize: 20 },
  // 💬 chat shortcut — stacked under the 🚨 alert demo button.
  chatFab: {
    position: 'absolute',
    top: 216,
    left: 12,
    backgroundColor: '#fff',
    borderRadius: 24,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
    zIndex: 10,
  },
  chatFabIcon: { fontSize: 20 },

  locationButton: {
    position: "absolute",
    bottom: 40,
    right: 16,
    backgroundColor: "#fff",
    borderRadius: 30,
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  locationButtonWithPanel: {
    bottom: 190,
  },
  locationIcon: { fontSize: 22 },

  // Sim joystick toggle — sits one button above 📍.
  simToggle: {
    position: 'absolute', bottom: 100, right: 16,
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
    bottom: 100,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9,
  },

  panel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 10,
  },
  panelClose: { position: "absolute", top: 14, right: 16, padding: 6 },
  panelCloseText: { fontSize: 18, color: "#aaa" },
  panelName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#222",
    marginBottom: 16,
    marginLeft: 32,
    textAlign: "left",
  },
  panelActions: {
    flexDirection: "row",
    gap: 10,
  },
  panelActionsBtn: {
    flex: 1,
  },
  navBtn: {
    backgroundColor: "#1a73e8",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  navBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  homeBtn: {
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#1a73e8",
  },
  homeBtnText: { color: "#1a73e8", fontSize: 15, fontWeight: "700" },

  legend: {
    position: "absolute",
    top: 110,
    right: 12,
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 5,
    zIndex: 10,
    gap: 6,
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  legendLabel: {
    fontSize: 12,
    color: "#333",
    writingDirection: "rtl",
  },
});
