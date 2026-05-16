import { useEffect, useMemo, useRef, useState, memo, useCallback } from "react";
import {
  View,
  StyleSheet,
  Text,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
  Animated,
  Dimensions,
  Alert,
  TextInput,
} from "react-native";
import { useAuth } from "@/context/auth";
import MapView, { Marker, Circle, PROVIDER_DEFAULT } from "react-native-maps";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";

const API_URL = process.env.EXPO_PUBLIC_API_URL;

const ISRAEL_REGION = {
  latitude: 31.5,
  longitude: 34.8,
  latitudeDelta: 3,
  longitudeDelta: 3,
};

type Pin = { latitude: number; longitude: number; name: string };
type ShelterPin = {
  _id?: string;
  latitude: number;
  longitude: number;
  name: string;
  address: string;
  neighborhood?: string;
  area?: string;
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
};

const ACCESS_LABELS: Record<string, string> = {
  open: "Open",
  closed: "Closed",
  locked: "Locked",
  unknown: "Unknown",
};
const ACCESS_COLORS: Record<string, string> = {
  open: "#1D9E75",
  closed: "#E24B4A",
  locked: "#888780",
  unknown: "#BA7517",
};
const CLEAN_LABELS: Record<string, string> = {
  clean: "Clean",
  dirty: "Dirty",
  unknown: "Unknown",
};
const TYPE_LABELS: Record<string, string> = {
  "public shelter": "Public Shelter",
  school: "School",
  parking: "Parking",
  other: "Other",
};

export default function MapScreen() {
  const { user } = useAuth();
  const mapRef = useRef<MapView>(null);
  const [region, setRegion] = useState(ISRAEL_REGION);
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
  const [selectedShelter, setSelectedShelter] = useState<ShelterPin | null>(
    null,
  );
  // Current visible map region — used for viewport culling
  const [visibleRegion, setVisibleRegion] = useState(ISRAEL_REGION);
  // Home "do not notify" circle — loaded from settings (AsyncStorage)
  const [home, setHome] = useState<{ lat: number; lng: number; radius: number } | null>(null);

  // Load shelters and convert addresses to coordinates
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/shelters`);
        const data = await res.json();
        const shelters = data.shelters || [];

        const pins: ShelterPin[] = [];
        for (const sh of shelters) {
          // If coordinates already exist in the database, use them
          const lat = sh.lat ?? sh.latitude;
          const lng = sh.lng ?? sh.longitude;
          const buildPin = (la: number, lo: number): ShelterPin => ({
            _id: sh._id ?? sh.id,
            latitude: la,
            longitude: lo,
            name: sh.name || "",
            address: sh.address || "",
            neighborhood: sh.neighborhood,
            area: sh.area,
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
          });
          if (typeof lat === "number" && typeof lng === "number" && lat !== 0) {
            pins.push(buildPin(lat, lng));
          }
          // Skip shelters without coords — never geocode (causes memory pressure on iOS)
        }
        setShelterPins(pins);
      } catch (e) {
        console.error("Failed to load shelters:", e);
      }
    })();
  }, []);

  // Reload home settings every time the map gains focus, so the circle reflects
  // whatever the user most recently saved in Settings.
  useFocusEffect(
    useCallback(() => {
      (async () => {
        try {
          const saved = await AsyncStorage.getItem("userSettings");
          if (!saved) {
            setHome(null);
            return;
          }
          const p = JSON.parse(saved);
          const lat = typeof p.homeLat === "number" ? p.homeLat : null;
          const lng = typeof p.homeLng === "number" ? p.homeLng : null;
          const radius = parseFloat(p.radius);
          // Only show the circle when we have valid coords AND a positive radius
          if (lat != null && lng != null && !isNaN(radius) && radius > 0) {
            setHome({ lat, lng, radius });
          } else {
            setHome(null);
          }
        } catch {
          setHome(null);
        }
      })();
    }, []),
  );

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const loc = await Location.getCurrentPositionAsync({});
        const coords = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        };
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
        500,
      );
    }
  };

  // ── Map tap → marker + panel ─────────────────────────────────────────
  const handleMapPress = async (e: any) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;

    // Show coordinates temporarily until address resolves
    setPin({
      latitude,
      longitude,
      name: "Loading address...",
    });

    try {
      const results = await Location.reverseGeocodeAsync({
        latitude,
        longitude,
      });
      if (results.length > 0) {
        const r = results[0];
        // Build readable address: street + number, city
        const street = [r.street, r.streetNumber].filter(Boolean).join(" ");
        const city = r.city || r.subregion || r.region || "";
        const address =
          [street, city].filter(Boolean).join(", ") ||
          `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

        setPin({ latitude, longitude, name: address });
      } else {
        setPin({
          latitude,
          longitude,
          name: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
        });
      }
    } catch {
      setPin({
        latitude,
        longitude,
        name: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
      });
    }
  };

  // ── Address search — first tries shelter names, then Nominatim ──────
  const searchAddress = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    setSelectedShelter(null);
    setPin(null);

    // 1. Search loaded shelter names (case-insensitive, partial match)
    const lower = q.toLowerCase();
    const matched = shelterPins.find(sh =>
      sh.name.toLowerCase().includes(lower) ||
      (sh.address && sh.address.toLowerCase().includes(lower))
    );
    if (matched) {
      mapRef.current?.animateToRegion(
        { latitude: matched.latitude, longitude: matched.longitude, latitudeDelta: 0.005, longitudeDelta: 0.005 },
        500
      );
      setSelectedShelter(matched);
      setSearching(false);
      return;
    }

    // 2. Fall back to Nominatim address geocoding
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
        const latitude  = parseFloat(lat);
        const longitude = parseFloat(lon);
        mapRef.current?.animateToRegion(
          { latitude, longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 },
          500
        );
        setPin({ latitude, longitude, name: display_name });
      }
    } catch (e) {
      console.warn('Search failed:', e);
    } finally {
      setSearching(false);
    }
  }, [searchQuery, userLocation, shelterPins]);

  const navigateToPin = () => {
    if (!pin) return;
    router.push(
      `/navigate?lat=${pin.latitude}&lng=${pin.longitude}&name=${encodeURIComponent(pin.name)}`,
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

              // Sync to backend (best-effort — local copy is the source of truth here)
              const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "";
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

  const navigateToShelter = () => {
    if (!selectedShelter) return;
    router.push(
      `/navigate?lat=${selectedShelter.latitude}&lng=${selectedShelter.longitude}&name=${encodeURIComponent(selectedShelter.name)}`,
    );
  };

  const reportShelter = () => {
    if (!selectedShelter) return;
    router.push(
      `/report?shelterId=${selectedShelter._id}&shelterName=${encodeURIComponent(selectedShelter.name)}`,
    );
  };

  function timeAgo(dateStr?: string): string {
    if (!dateStr) return "—";
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins} min ago`;
    if (hours < 24) return `${hours} hr ago`;
    return `${days} days ago`;
  }

  // Close panel — plain synchronous close (no InteractionManager / Modal)
  const handleClosePanel = useCallback(() => {
    setSelectedShelter(null);
  }, []);

  // Region change throttling: only update visibleRegion when the user has
  // panned/zoomed meaningfully. Stops marker churn that leaks iOS memory.
  const regionUpdateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRegion = useRef(visibleRegion);
  const handleRegionChange = useCallback((r: typeof ISRAEL_REGION) => {
    const old = lastRegion.current;
    const latDiff  = Math.abs(r.latitude  - old.latitude);
    const lngDiff  = Math.abs(r.longitude - old.longitude);
    const zoomDiff = Math.abs(r.latitudeDelta - old.latitudeDelta);
    // Ignore tiny movements (less than ~10% of the current view size)
    if (
      latDiff  < old.latitudeDelta  * 0.1 &&
      lngDiff  < old.longitudeDelta * 0.1 &&
      zoomDiff < old.latitudeDelta  * 0.1
    ) return;

    if (regionUpdateTimer.current) clearTimeout(regionUpdateTimer.current);
    regionUpdateTimer.current = setTimeout(() => {
      lastRegion.current = r;
      setVisibleRegion(r);
    }, 400);
  }, []);

  // Clean up the timer on unmount
  useEffect(() => () => {
    if (regionUpdateTimer.current) clearTimeout(regionUpdateTimer.current);
  }, []);

  // Stable onPress so memoized markers never re-render
  const handleMarkerPress = useCallback((sh: ShelterPin) => {
    setSelectedShelter(sh);
    setPin(null);
  }, []);

  // Viewport culling — only render shelters visible on screen.
  // All shelters are loaded from the DB; this just limits what's rendered.
  const MAX_VISIBLE = 30;
  const ZOOM_THRESHOLD = 0.15; // latitudeDelta above this = too zoomed out

  const visibleShelters = useMemo(() => {
    // Zoom gate: don't render any markers when too far out
    if (visibleRegion.latitudeDelta > ZOOM_THRESHOLD) return [];

    const latMin = visibleRegion.latitude  - visibleRegion.latitudeDelta  / 2;
    const latMax = visibleRegion.latitude  + visibleRegion.latitudeDelta  / 2;
    const lngMin = visibleRegion.longitude - visibleRegion.longitudeDelta / 2;
    const lngMax = visibleRegion.longitude + visibleRegion.longitudeDelta / 2;

    const inView = shelterPins.filter(sh =>
      sh.latitude  >= latMin && sh.latitude  <= latMax &&
      sh.longitude >= lngMin && sh.longitude <= lngMax
    );

    // When over the cap, prioritise shelters closest to the user
    if (inView.length > MAX_VISIBLE && userLocation) {
      inView.sort((a, b) => {
        const dA = (a.latitude - userLocation.latitude) ** 2 + (a.longitude - userLocation.longitude) ** 2;
        const dB = (b.latitude - userLocation.latitude) ** 2 + (b.longitude - userLocation.longitude) ** 2;
        return dA - dB;
      });
    }

    return inView.slice(0, MAX_VISIBLE);
  }, [shelterPins, visibleRegion, userLocation]);

  // Memoize markers — stable key (no index) so markers aren't recreated on pan
  const shelterMarkers = useMemo(
    () =>
      visibleShelters.map((sh) => (
        <ShelterMarker
          key={`shelter-${sh.latitude}-${sh.longitude}`}
          sh={sh}
          color={getShelterColor(sh)}
          onPress={handleMarkerPress}
        />
      )),
    [visibleShelters, handleMarkerPress],
  );

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
      {/* Map */}
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={region}
        showsUserLocation={locationGranted}
        onPress={handleMapPress}
        onRegionChangeComplete={handleRegionChange}
      >
        {pin && (
          <Marker
            key={`pin-${pin.latitude}-${pin.longitude}`}
            coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
            pinColor="#1a73e8"
          />
        )}

        {/* Home "do not notify" radius circle */}
        {home && (
          <Circle
            center={{ latitude: home.lat, longitude: home.lng }}
            radius={home.radius}
            strokeColor="rgba(26,115,232,0.7)"
            strokeWidth={2}
            fillColor="rgba(26,115,232,0.15)"
          />
        )}

        {/* Shelter markers (memoized so they don't re-render on every state change) */}
        {shelterMarkers}
      </MapView>

      {/* Zoom-out hint — shown when too far out to display markers */}
      {visibleRegion.latitudeDelta > ZOOM_THRESHOLD && (
        <View style={styles.zoomHint} pointerEvents="none">
          <Text style={styles.zoomHintText}>🔍 Zoom in to see shelters</Text>
        </View>
      )}

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

      {/* Bottom panel for arbitrary map tap */}
      {pin && !selectedShelter && (
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

      {/* Rich panel for selected shelter — separate Modal so closing it doesn't re-layout the map */}
      <ShelterPanel
        shelter={selectedShelter}
        onClose={handleClosePanel}
        onNavigate={navigateToShelter}
        onReport={reportShelter}
      />
    </View>
  );
}

const SCREEN_H = Dimensions.get("window").height;

const ShelterPanel = memo(function ShelterPanel({
  shelter,
  onClose,
  onNavigate,
  onReport,
}: {
  shelter: ShelterPin | null;
  onClose: () => void;
  onNavigate: () => void;
  onReport: () => void;
}) {
  function timeAgo(dateStr?: string): string {
    if (!dateStr) return "—";
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins} min ago`;
    if (hours < 24) return `${hours} hr ago`;
    return `${days} days ago`;
  }

  // Keep the panel mounted while it animates out. `displayed` is the data we render,
  // `shelter` is the data the parent currently wants visible.
  const [displayed, setDisplayed] = useState<ShelterPin | null>(shelter);
  const translateY = useRef(new Animated.Value(SCREEN_H)).current;

  useEffect(() => {
    if (shelter) {
      // Opening — swap content immediately, slide up
      setDisplayed(shelter);
      Animated.timing(translateY, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start();
    } else if (displayed) {
      // Closing — slide down, then unmount content
      Animated.timing(translateY, {
        toValue: SCREEN_H,
        duration: 220,
        useNativeDriver: true,
      }).start(() => setDisplayed(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shelter]);

  if (!displayed) return null;
  const sh = displayed; // alias so the rest of the JSX can use `sh`

  return (
    <Animated.View
      style={[styles.shelterPanel, { transform: [{ translateY }] }]}
      pointerEvents="box-none"
    >
          <TouchableOpacity style={styles.panelClose} onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={styles.panelCloseText}>✕</Text>
          </TouchableOpacity>

      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={styles.shelterTitle} numberOfLines={2}>
          {sh.name || "Shelter"}
        </Text>

        <View style={styles.iconRow}>
          {sh.isAccessible && !sh.hasStairs && (
            <Text style={styles.bigIcon}>♿</Text>
          )}
          {!sh.petIssueReported && (
            <Text style={styles.bigIcon}>🐾</Text>
          )}
        </View>

        <View style={styles.badgeRow}>
          <View
            style={[
              styles.badge,
              {
                borderColor: ACCESS_COLORS[sh.accessStatus || "unknown"] + "88",
                backgroundColor: ACCESS_COLORS[sh.accessStatus || "unknown"] + "22",
              },
            ]}
          >
            <Text style={[styles.badgeTxt, { color: ACCESS_COLORS[sh.accessStatus || "unknown"] }]}>
              {ACCESS_LABELS[sh.accessStatus || "unknown"]}
            </Text>
          </View>

          <View
            style={[
              styles.badge,
              {
                borderColor: (sh.isFull ? "#E24B4A" : "#1D9E75") + "88",
                backgroundColor: (sh.isFull ? "#E24B4A" : "#1D9E75") + "22",
              },
            ]}
          >
            <Text style={[styles.badgeTxt, { color: sh.isFull ? "#E24B4A" : "#1D9E75" }]}>
              {sh.isFull ? "Full" : "Available"}
            </Text>
          </View>
        </View>

        <DataRow label="Address" value={sh.address || "—"} />
        <DataRow label="Neighborhood" value={sh.neighborhood || "—"} />
        <DataRow label="Area" value={sh.area || "—"} />
        <DataRow label="City" value={sh.city || "—"} />
        <DataRow
          label="Type"
          value={TYPE_LABELS[sh.placeType || ""] || sh.placeType || "—"}
        />
        <DataRow
          label="Capacity"
          value={sh.capacity != null ? String(sh.capacity) : "—"}
        />
        <DataRow
          label="Cleanliness"
          value={CLEAN_LABELS[sh.cleanlinessStatus || "unknown"]}
        />
        <DataRow
          label="Should Be Open"
          value={sh.shouldBeOpen ? "✓ Yes" : "✗ No"}
        />
        <DataRow label="Has Stairs" value={sh.hasStairs ? "Yes" : "No"} />
        <DataRow label="Accessible" value={sh.isAccessible ? "Yes" : "No"} />
        <DataRow label="Last Report" value={timeAgo(sh.lastReportAt)} />
        {sh.lastReportType && (
          <DataRow label="Report Type" value={sh.lastReportType} />
        )}
      </ScrollView>

      <View style={styles.panelActions}>
        <TouchableOpacity style={[styles.navBtn, styles.panelActionsBtn]} onPress={onNavigate}>
          <Text style={styles.navBtnText}>🧭 Navigate</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.reportBtn, styles.panelActionsBtn]} onPress={onReport}>
          <Text style={styles.reportBtnText}>⚠️ Report</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
});

// ── Background color logic — separate feature ────────────────────────
// Intentionally isolated so the color feature can be changed independently
// from the marker icon design.
// TODO: replace with real color logic when the color feature is implemented.
function getShelterColor(_sh: ShelterPin): string {
  return '#1D9E75'; // uniform until color feature is implemented
}

// ── Marker icon design — separate from color ─────────────────────────
const ShelterMarker = memo(function ShelterMarker({
  sh,
  color,
  onPress,
}: {
  sh: ShelterPin;
  color: string;
  onPress: (sh: ShelterPin) => void;
}) {
  const icon = '🏠';

  return (
    <Marker
      coordinate={{ latitude: sh.latitude, longitude: sh.longitude }}
      tracksViewChanges={false}
      stopPropagation
      anchor={{ x: 0.5, y: 1 }}
      onPress={(e) => { e.stopPropagation?.(); onPress(sh); }}
    >
      <View style={[mk.wrap, { backgroundColor: color }]}>
        <Text style={mk.icon}>{icon}</Text>
      </View>
      <View style={[mk.tip, { borderTopColor: color }]} />
    </Marker>
  );
});

// Marker bubble styles — kept outside component so they never recreate
const mk = StyleSheet.create({
  wrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
  icon: { fontSize: 16 },
  tip: {
    width: 0,
    height: 0,
    alignSelf: 'center',
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
});

const DataRow = memo(function DataRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.dataRow}>
      <Text style={styles.dataLabel}>{label}</Text>
      <Text style={styles.dataValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
});

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
    bottom: 170,
  },
  locationIcon: { fontSize: 22 },

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
  reportBtn: {
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#E24B4A",
  },
  reportBtnText: { color: "#E24B4A", fontSize: 16, fontWeight: "700" },

  // Zoom-out hint bar
  zoomHint: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(50,50,50,0.75)',
    paddingVertical: 10,
    alignItems: 'center',
  },
  zoomHintText: { color: '#fff', fontSize: 14, fontWeight: '500' },

  // Tap-outside backdrop for the modal panel
  modalBackdrop: { flex: 1, backgroundColor: 'transparent' },

  // Rich shelter panel
  shelterPanel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: "70%",
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 12,
  },
  shelterTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#222",
    marginRight: 32,
    marginBottom: 10,
  },
  iconRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  bigIcon: { fontSize: 24 },
  badgeRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
    flexWrap: "wrap",
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
  },
  badgeTxt: { fontSize: 13, fontWeight: "600" },

  dataRow: {
    flexDirection: "row",
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: "#eee",
  },
  dataLabel: { width: 130, fontSize: 13, color: "#888", fontWeight: "500" },
  dataValue: { flex: 1, fontSize: 14, color: "#222" },
});
