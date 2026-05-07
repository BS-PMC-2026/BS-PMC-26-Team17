import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, SafeAreaView,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import * as Location from 'expo-location';
import { useLocalSearchParams, router } from 'expo-router';
import SimJoystick from '@/components/SimJoystick'; // ← הסר כשמסיימים לבדוק

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = 'foot' | 'cycling' | 'driving';
type Coord = { latitude: number; longitude: number };

const MODES: { key: Mode; label: string; icon: string }[] = [
  { key: 'foot',    label: 'הליכה',   icon: '🚶' },
  { key: 'cycling', label: 'אופניים', icon: '🚴' },
  { key: 'driving', label: 'רכב',     icon: '🚗' },
];

// ─── פונקציות עזר ─────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} דק׳`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}:${m.toString().padStart(2, '0')} שע׳`;
}

function formatDistance(meters: number): string {
  return meters < 1000
    ? `${Math.round(meters)} מ׳`
    : `${(meters / 1000).toFixed(1)} ק״מ`;
}

function stepToHeb(step: any): string {
  const type     = step?.maneuver?.type || '';
  const modifier = step?.maneuver?.modifier || '';
  const name     = step?.name || '';
  if (type === 'depart')           return `התחל את המסלול${name ? ` ב-${name}` : ''}`;
  if (type === 'arrive')           return '🏁 הגעת ליעד!';
  if (modifier === 'left')         return `פנה שמאלה${name ? ` ב-${name}` : ''}`;
  if (modifier === 'right')        return `פנה ימינה${name ? ` ב-${name}` : ''}`;
  if (modifier === 'slight left')  return `מעט שמאלה${name ? ` ב-${name}` : ''}`;
  if (modifier === 'slight right') return `מעט ימינה${name ? ` ב-${name}` : ''}`;
  if (modifier === 'straight')     return `המשך ישר${name ? ` ב-${name}` : ''}`;
  if (modifier === 'uturn')        return 'פנה פניית פרסה';
  return name ? `המשך ב-${name}` : 'המשך ישר';
}

function nearestStepIndex(steps: any[], loc: Coord): number {
  let best = 0, bestDist = Infinity;
  steps.forEach((step, i) => {
    const [lng, lat] = step.maneuver.location;
    const d = Math.hypot(lat - loc.latitude, lng - loc.longitude);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
}

// מציאת הנקודה הקרובה ביותר בפוליליין
function nearestPolylineIndex(polyline: Coord[], loc: Coord): number {
  let best = 0, bestDist = Infinity;
  polyline.forEach((pt, i) => {
    const d = Math.hypot(pt.latitude - loc.latitude, pt.longitude - loc.longitude);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
}

// מרחק האורווצ׳י (מטרים) בין שתי נקודות
function haversineM(a: Coord, b: Coord): number {
  const R = 6371000;
  const dLat = (b.latitude  - a.latitude)  * Math.PI / 180;
  const dLng = (b.longitude - a.longitude) * Math.PI / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * Math.PI / 180) *
    Math.cos(b.latitude * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// מרחק מינימלי (מטרים) מנקודה לפוליליין
function distToPolyline(point: Coord, line: Coord[]): number {
  if (!line.length) return 0;
  return line.reduce((min, pt) => Math.min(min, haversineM(point, pt)), Infinity);
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function NavigateScreen() {
  const { lat, lng, name } = useLocalSearchParams<{ lat: string; lng: string; name: string }>();
  const destLat = parseFloat(lat || '0');
  const destLng = parseFloat(lng || '0');

  const mapRef           = useRef<MapView>(null);
  const watchRef         = useRef<Location.LocationSubscription | null>(null);
  const stepsRef         = useRef<any[]>([]);
  const polylineRef      = useRef<Coord[]>([]);
  const modeRef          = useRef<Mode>('foot');    // ref יציב לשימוש ב-callbacks
  const recalcCooldown   = useRef(false);           // מניעת recalc כפול
  const OFF_ROUTE_M      = 50;                       // מטרים לסטייה מהמסלול

  const [mode, setMode]                 = useState<Mode>('foot');
  const [userLocation, setUserLocation] = useState<Coord | null>(null);
  const [simCoords, setSimCoords]       = useState<Coord | null>(null); // ← הסר כשמסיימים לבדוק
  const [polyline, setPolyline]           = useState<Coord[]>([]);
  const [displayPolyline, setDisplayPolyline] = useState<Coord[]>([]); // מה שמוצג — תמיד ref חדש
  const [mapReady, setMapReady]         = useState(false); // האם MapView מוכן לקבל Polyline
  const [steps, setSteps]               = useState<any[]>([]);
  const [currentStep, setCurrentStep]   = useState(0);
  const [eta, setEta]                   = useState('');
  const [distance, setDistance]         = useState('');
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');

  // ─── Effect 1: מיקום ראשוני — רץ פעם אחת ────────────────────────────────
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setError('נדרשת הרשאת מיקום'); return; }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setUserLocation(coords); // יפעיל את Effect 2
      mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.05, longitudeDelta: 0.05 }, 500);
    })();
  }, []);

  // ─── Effect 2: שליפת מסלול — רץ כשיש מיקום ראשוני, ובכל שינוי mode ──────
  // cleanup מבטל בקשה ישנה → אין race condition ואין לולאה
  useEffect(() => {
    if (!userLocation) return;
    let cancelled = false;

    const doFetch = async () => {
      setLoading(true);
      setError('');
      try {
        // OSRM הציבורי תומך רק ב-driving לגיאומטריה אמינה
        // הזמן מחושב לפי מהירות ממוצעת לכל מצב
        const url =
          `https://router.project-osrm.org/route/v1/driving/` +
          `${userLocation.longitude},${userLocation.latitude};${destLng},${destLat}` +
          `?overview=full&geometries=geojson&steps=true`;
        const res  = await fetch(url);
        const data = await res.json();

        if (cancelled) return;
        if (!data.routes?.length) { setError('לא נמצא מסלול'); return; }

        const route = data.routes[0];
        const coords: Coord[] = route.geometry.coordinates.map(([lo, la]: number[]) => ({
          latitude: la, longitude: lo,
        }));

        // מהירות ממוצעת לפי מצב (קמ"ש)
        const speedKmh: Record<Mode, number> = { foot: 5, cycling: 15, driving: -1 };
        const durationSec = speedKmh[mode] > 0
          ? (route.distance / 1000 / speedKmh[mode]) * 3600  // חישוב ידני
          : route.duration;                                    // OSRM (רכב)

        polylineRef.current = coords;   // עדכון מיידי — לפני render, לפני GPS callback
        setPolyline(coords);
        setDisplayPolyline([...coords]); // ref חדש → react-native-maps מזהה שינוי
        setSteps(route.legs[0].steps);
        stepsRef.current = route.legs[0].steps;
        setCurrentStep(0);
        setEta(formatDuration(durationSec));
        setDistance(formatDistance(route.distance));
      } catch {
        if (!cancelled) setError('שגיאה בטעינת המסלול');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    doFetch();
    return () => { cancelled = true; };
  }, [userLocation, mode, destLat, destLng]);

  // ─── סנכרון modeRef ──────────────────────────────────────────────────────
  useEffect(() => { modeRef.current = mode; }, [mode]);

  // ─── עדכון מיקום — משותף לג׳ויסטיק ול-GPS ───────────────────────────────
  function advanceOnRoute(coords: Coord) {
    if (stepsRef.current.length > 0) {
      setCurrentStep(nearestStepIndex(stepsRef.current, coords));
    }

    if (polylineRef.current.length > 0) {
      const idx = nearestPolylineIndex(polylineRef.current, coords);
      const remaining_line = polylineRef.current.slice(idx);
      setDisplayPolyline(remaining_line); // ref חדש — react-native-maps מזהה מיד

      // חישוב מרחק וזמן נותרים
      let remaining = 0;
      for (let i = idx; i < polylineRef.current.length - 1; i++) {
        remaining += haversineM(polylineRef.current[i], polylineRef.current[i + 1]);
      }
      const speedKmh: Record<Mode, number> = { foot: 5, cycling: 15, driving: 60 };
      const durationSec = (remaining / 1000 / speedKmh[modeRef.current]) * 3600;
      setDistance(formatDistance(remaining));
      setEta(formatDuration(durationSec));
    }

    // בדיקת סטייה מהמסלול → חישוב מחדש
    if (polylineRef.current.length > 0 && !recalcCooldown.current) {
      const dist = distToPolyline(coords, polylineRef.current);
      if (dist > OFF_ROUTE_M) {
        recalcCooldown.current = true;
        setUserLocation({ ...coords });
        setTimeout(() => { recalcCooldown.current = false; }, 8000);
      }
    }
  }

  function handleSimMove(coords: Coord) {
    setSimCoords(coords);
    mapRef.current?.animateToRegion(
      { ...coords, latitudeDelta: 0.005, longitudeDelta: 0.005 }, 150
    );
    advanceOnRoute(coords);
  }

  // ─── Effect 3: מעקב מיקום — רץ פעם אחת, לא תלוי ב-steps ────────────────
  useEffect(() => {
    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, distanceInterval: 10 },
      (loc) => {
        const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        mapRef.current?.animateToRegion(
          { ...coords, latitudeDelta: 0.005, longitudeDelta: 0.005 }, 300
        );
        advanceOnRoute(coords);
      }
    ).then(sub => { watchRef.current = sub; });

    return () => { watchRef.current?.remove(); };
  }, []); // ריק — רץ פעם אחת, קורא ל-stepsRef ולא משנה state שמפעיל effects

  const arrived = steps[currentStep]?.maneuver?.type === 'arrive';

  return (
    <SafeAreaView style={s.container}>

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.closeBtn} onPress={() => router.back()}>
          <Text style={s.closeIcon}>✕</Text>
        </TouchableOpacity>
        <View style={s.headerInfo}>
          <Text style={s.destName} numberOfLines={1}>{name || 'מקלט'}</Text>
          {eta && distance
            ? <Text style={s.etaText}>{eta}  ·  {distance}</Text>
            : null}
        </View>
      </View>

      {/* Mode Selector */}
      <View style={s.modeRow}>
        {MODES.map(m => (
          <TouchableOpacity
            key={m.key}
            style={[s.modeBtn, mode === m.key && s.modeBtnOn]}
            onPress={() => setMode(m.key)}
          >
            <Text style={s.modeIcon}>{m.icon}</Text>
            <Text style={[s.modeLabel, mode === m.key && s.modeLabelOn]}>{m.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Map */}
      <MapView
        ref={mapRef}
        style={s.map}
        provider={PROVIDER_DEFAULT}
        showsUserLocation={!simCoords} // ← מוסתר כשסימולטור פעיל
        initialRegion={{
          latitude: destLat, longitude: destLng,
          latitudeDelta: 0.05, longitudeDelta: 0.05,
        }}
        onMapReady={() => {
          setMapReady(true);
          // אם המסלול כבר נטען לפני שה-Map היה מוכן — כפה render חדש
          if (polylineRef.current.length > 0) {
            setDisplayPolyline([...polylineRef.current]);
          }
        }}
      >
        {mapReady && displayPolyline.length >= 2 && (
          <Polyline
            coordinates={displayPolyline}
            strokeColor="#1a73e8"
            strokeWidth={4}
          />
        )}
        <Marker
          coordinate={{ latitude: destLat, longitude: destLng }}
          pinColor="red"
          title={name || 'מקלט'}
        />
        {/* נקודה מדומה — מוצגת רק כשסימולטור פעיל */}
        {simCoords && (
          <Marker coordinate={simCoords} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={s.simDot}>
              <View style={s.simDotInner} />
            </View>
          </Marker>
        )}
      </MapView>

      {/* SimJoystick — הסר את השורה הבאה כשמסיימים לבדוק */}
      <SimJoystick startCoords={userLocation} onPositionChange={handleSimMove} />

      {/* Loading */}
      {loading && (
        <View style={s.loadingOverlay}>
          <ActivityIndicator size="large" color="#1a73e8" />
          <Text style={s.loadingText}>מחשב מסלול...</Text>
        </View>
      )}

      {/* HUD */}
      <View style={[s.hud, arrived && s.hudArrived]}>
        {error ? (
          <Text style={s.hudError}>{error}</Text>
        ) : steps.length > 0 ? (
          <>
            <Text style={s.hudStep}>{stepToHeb(steps[currentStep])}</Text>
            {!arrived && steps[currentStep + 1] && (
              <Text style={s.hudNext}>אחר כך: {stepToHeb(steps[currentStep + 1])}</Text>
            )}
          </>
        ) : (
          <Text style={s.hudStep}>מאתר מיקום...</Text>
        )}
      </View>

    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#fff' },
  header:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  closeBtn:       { width: 36, height: 36, borderRadius: 18, backgroundColor: '#f2f2f2', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  closeIcon:      { fontSize: 16, color: '#555' },
  headerInfo:     { flex: 1 },
  destName:       { fontSize: 17, fontWeight: '700', color: '#111' },
  etaText:        { fontSize: 13, color: '#1a73e8', marginTop: 2 },
  modeRow:        { flexDirection: 'row', justifyContent: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 16, backgroundColor: '#fff' },
  modeBtn:        { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 12, borderWidth: 1.5, borderColor: '#ddd', backgroundColor: '#fafafa' },
  modeBtnOn:      { borderColor: '#1a73e8', backgroundColor: '#e8f0fe' },
  modeIcon:       { fontSize: 22 },
  modeLabel:      { fontSize: 12, color: '#888', marginTop: 2 },
  modeLabelOn:    { color: '#1a73e8', fontWeight: '600' },
  map:            { flex: 1 },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#fff8', alignItems: 'center', justifyContent: 'center' },
  loadingText:    { marginTop: 10, color: '#555' },
  hud:            { backgroundColor: '#1a73e8', paddingHorizontal: 20, paddingVertical: 16, minHeight: 80, justifyContent: 'center' },
  hudArrived:     { backgroundColor: '#1D9E75' },
  hudStep:        { fontSize: 18, fontWeight: '700', color: '#fff', textAlign: 'right' },
  hudNext:        { fontSize: 13, color: '#ffffffaa', marginTop: 6, textAlign: 'right' },
  hudError:       { fontSize: 16, color: '#fff', textAlign: 'center' },
  // נקודה כחולה מדומה (סימולטור)
  simDot:      { width: 24, height: 24, borderRadius: 12, backgroundColor: '#4285f488', alignItems: 'center', justifyContent: 'center' },
  simDotInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#4285f4', borderWidth: 2, borderColor: '#fff' },
});
