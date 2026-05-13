import { useEffect, useMemo, useRef, useState, memo, useCallback } from "react";
import {
  View,
  StyleSheet,
  Text,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
  Modal,
  InteractionManager,
} from "react-native";
import MapView, { Marker, PROVIDER_DEFAULT } from "react-native-maps";
import * as Location from "expo-location";
import { router } from "expo-router";

const API_URL = process.env.EXPO_PUBLIC_API_URL;

const ISRAEL_REGION = {
  latitude: 31.5,
  longitude: 34.8,
  latitudeDelta: 3,
  longitudeDelta: 3,
};

type Pin = { latitude: number; longitude: number; name: string };
type ShelterPin = {
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
  const [selectedShelter, setSelectedShelter] = useState<ShelterPin | null>(
    null,
  );
  // Marker tracking: true on first render so pins paint, then flip to false for perf
  const [tracksChanges, setTracksChanges] = useState(true);
  // Current visible map region — used for viewport culling
  const [visibleRegion, setVisibleRegion] = useState(ISRAEL_REGION);

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
            continue;
          }
          // Otherwise - convert address to coordinates
          if (!sh.address) continue;
          try {
            const fullAddr = sh.city ? `${sh.address}, ${sh.city}` : sh.address;
            const results = await Location.geocodeAsync(fullAddr);
            if (results.length > 0) {
              pins.push(buildPin(results[0].latitude, results[0].longitude));
            }
          } catch {
            // continue to next address
          }
        }
        setShelterPins(pins);
        // After markers paint, disable tracking for performance
        setTimeout(() => setTracksChanges(false), 800);
      } catch (e) {
        console.error("Failed to load shelters:", e);
      }
    })();
  }, []);

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

  const navigateToPin = () => {
    if (!pin) return;
    router.push(
      `/navigate?lat=${pin.latitude}&lng=${pin.longitude}&name=${encodeURIComponent(pin.name)}`,
    );
  };

  const navigateToShelter = () => {
    if (!selectedShelter) return;
    router.push(
      `/navigate?lat=${selectedShelter.latitude}&lng=${selectedShelter.longitude}&name=${encodeURIComponent(selectedShelter.name)}`,
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

  // Close panel — defer state update so the tap feels instant
  const handleClosePanel = useCallback(() => {
    InteractionManager.runAfterInteractions(() => {
      setSelectedShelter(null);
    });
  }, []);

  // Stable onPress so memoized markers never re-render
  const handleMarkerPress = useCallback((sh: ShelterPin) => {
    setSelectedShelter(sh);
    setPin(null);
  }, []);

  // Viewport culling — only show shelters in the visible region.
  // Caps at MAX_VISIBLE so even if you zoom way out we never render hundreds.
  const MAX_VISIBLE = 60;
  const visibleShelters = useMemo(() => {
    const latMin = visibleRegion.latitude  - visibleRegion.latitudeDelta  / 2;
    const latMax = visibleRegion.latitude  + visibleRegion.latitudeDelta  / 2;
    const lngMin = visibleRegion.longitude - visibleRegion.longitudeDelta / 2;
    const lngMax = visibleRegion.longitude + visibleRegion.longitudeDelta / 2;
    const inView: ShelterPin[] = [];
    for (const sh of shelterPins) {
      if (
        sh.latitude  >= latMin && sh.latitude  <= latMax &&
        sh.longitude >= lngMin && sh.longitude <= lngMax
      ) {
        inView.push(sh);
        if (inView.length >= MAX_VISIBLE) break;
      }
    }
    return inView;
  }, [shelterPins, visibleRegion]);

  // Memoize markers based on the culled list
  const shelterMarkers = useMemo(
    () =>
      visibleShelters.map((sh, i) => (
        <ShelterMarker
          key={`shelter-${sh.latitude}-${sh.longitude}-${i}`}
          sh={sh}
          onPress={handleMarkerPress}
          tracksChanges={tracksChanges}
        />
      )),
    [visibleShelters, handleMarkerPress, tracksChanges],
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
        onRegionChangeComplete={(r) => setVisibleRegion(r)}
      >
        {pin && (
          <Marker
            key={`pin-${pin.latitude}-${pin.longitude}`}
            coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
            pinColor="#1a73e8"
          />
        )}

        {/* Shelter markers (memoized so they don't re-render on every state change) */}
        {shelterMarkers}
      </MapView>

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
          <TouchableOpacity style={styles.navBtn} onPress={navigateToPin}>
            <Text style={styles.navBtnText}>🧭 Navigate Here</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Rich panel for selected shelter — separate Modal so closing it doesn't re-layout the map */}
      <ShelterPanel
        shelter={selectedShelter}
        onClose={handleClosePanel}
        onNavigate={navigateToShelter}
      />
    </View>
  );
}

const ShelterPanel = memo(function ShelterPanel({
  shelter,
  onClose,
  onNavigate,
}: {
  shelter: ShelterPin | null;
  onClose: () => void;
  onNavigate: () => void;
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

  return (
    <Modal
      visible={!!shelter}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      hardwareAccelerated
    >
      <TouchableOpacity
        style={styles.modalBackdrop}
        activeOpacity={1}
        onPress={onClose}
      />
      {shelter && (
        <View style={styles.shelterPanel}>
          <TouchableOpacity style={styles.panelClose} onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={styles.panelCloseText}>✕</Text>
          </TouchableOpacity>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.shelterTitle} numberOfLines={2}>
              {shelter.name || "Shelter"}
            </Text>

            <View style={styles.iconRow}>
              {shelter.isAccessible && !shelter.hasStairs && (
                <Text style={styles.bigIcon}>♿</Text>
              )}
              {!shelter.petIssueReported && (
                <Text style={styles.bigIcon}>🐾</Text>
              )}
            </View>

            <View style={styles.badgeRow}>
              <View
                style={[
                  styles.badge,
                  {
                    borderColor: ACCESS_COLORS[shelter.accessStatus || "unknown"] + "88",
                    backgroundColor: ACCESS_COLORS[shelter.accessStatus || "unknown"] + "22",
                  },
                ]}
              >
                <Text style={[styles.badgeTxt, { color: ACCESS_COLORS[shelter.accessStatus || "unknown"] }]}>
                  {ACCESS_LABELS[shelter.accessStatus || "unknown"]}
                </Text>
              </View>

              <View
                style={[
                  styles.badge,
                  {
                    borderColor: (shelter.isFull ? "#E24B4A" : "#1D9E75") + "88",
                    backgroundColor: (shelter.isFull ? "#E24B4A" : "#1D9E75") + "22",
                  },
                ]}
              >
                <Text style={[styles.badgeTxt, { color: shelter.isFull ? "#E24B4A" : "#1D9E75" }]}>
                  {shelter.isFull ? "Full" : "Available"}
                </Text>
              </View>
            </View>

            <DataRow label="Address" value={shelter.address || "—"} />
            <DataRow label="Neighborhood" value={shelter.neighborhood || "—"} />
            <DataRow label="Area" value={shelter.area || "—"} />
            <DataRow label="City" value={shelter.city || "—"} />
            <DataRow
              label="Type"
              value={TYPE_LABELS[shelter.placeType || ""] || shelter.placeType || "—"}
            />
            <DataRow
              label="Capacity"
              value={shelter.capacity != null ? String(shelter.capacity) : "—"}
            />
            <DataRow
              label="Cleanliness"
              value={CLEAN_LABELS[shelter.cleanlinessStatus || "unknown"]}
            />
            <DataRow
              label="Should Be Open"
              value={shelter.shouldBeOpen ? "✓ Yes" : "✗ No"}
            />
            <DataRow label="Has Stairs" value={shelter.hasStairs ? "Yes" : "No"} />
            <DataRow label="Accessible" value={shelter.isAccessible ? "Yes" : "No"} />
            <DataRow label="Last Report" value={timeAgo(shelter.lastReportAt)} />
            {shelter.lastReportType && (
              <DataRow label="Report Type" value={shelter.lastReportType} />
            )}
          </ScrollView>

          <TouchableOpacity style={styles.navBtn} onPress={onNavigate}>
            <Text style={styles.navBtnText}>🧭 Navigate Here</Text>
          </TouchableOpacity>
        </View>
      )}
    </Modal>
  );
});

const ShelterMarker = memo(function ShelterMarker({
  sh,
  onPress,
  tracksChanges,
}: {
  sh: ShelterPin;
  onPress: (sh: ShelterPin) => void;
  tracksChanges: boolean;
}) {
  const color = sh.isFull
    ? "#E24B4A"
    : sh.accessStatus === "closed" || sh.accessStatus === "locked"
      ? "#888780"
      : "#1D9E75";
  return (
    <Marker
      coordinate={{ latitude: sh.latitude, longitude: sh.longitude }}
      pinColor={color}
      tracksViewChanges={tracksChanges}
      stopPropagation
      onPress={(e) => {
        e.stopPropagation?.();
        onPress(sh);
      }}
    />
  );
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
  navBtn: {
    backgroundColor: "#1a73e8",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  navBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },

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
