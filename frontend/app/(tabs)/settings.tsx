import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  TextInput,
  Switch,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  DeviceEventEmitter,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '@/context/auth';
import {
  GEOFENCE_SETTINGS_CHANGED_EVENT,
  ACCESSIBILITY_SETTINGS_CHANGED_EVENT,
} from '@/hooks/use-home-geofence';

// Nominatim suggestion shape (the parts we care about)
type NominatimResult = {
  display_name: string;
  lat: string;
  lon: string;
  address?: {
    road?: string;
    house_number?: string;
    pedestrian?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
  };
};

type AddressPick = { label: string; lat: number; lng: number };

// Format a Nominatim result as "Street [number], City". Falls back to
// display_name's first two segments if the structured fields are missing.
function formatSuggestion(r: NominatimResult): string {
  const a = r.address || {};
  const street = a.road || a.pedestrian;
  const city = a.city || a.town || a.village || a.municipality;
  if (street && city) {
    return a.house_number ? `${street} ${a.house_number}, ${city}` : `${street}, ${city}`;
  }
  // Fallback: take first two comma-separated parts
  const parts = r.display_name.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.slice(0, 2).join(', ');
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();

  // Form state
  const [address, setAddress] = useState('');
  const [homeLat, setHomeLat] = useState<number | null>(null);
  const [homeLng, setHomeLng] = useState<number | null>(null);
  const [radius, setRadius] = useState('');
  const [transportMode, setTransportMode] = useState('walking');
  const [isHandicapped, setIsHandicapped] = useState(false);

  // Autocomplete state
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [searching, setSearching] = useState(false);
  // Track whether the current address text matches a picked suggestion (has coords)
  const [addressIsPicked, setAddressIsPicked] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Building manager registration status (BSPMT17-371/374)
  const [myRegistration, setMyRegistration] = useState<
    | { id: string; registrationStatus: string }
    | null
  >(null);

  // Reload settings every time the screen comes into focus, so updates made
  // from the map (e.g., "Set as Home") show up here without a restart.
  useFocusEffect(
    useCallback(() => {
      (async () => {
        try {
          const saved = await AsyncStorage.getItem('userSettings');
          if (!saved) return;
          const p = JSON.parse(saved);
          setAddress(p.address || '');
          setHomeLat(typeof p.homeLat === 'number' ? p.homeLat : null);
          setHomeLng(typeof p.homeLng === 'number' ? p.homeLng : null);
          setRadius(p.radius || '');
          setTransportMode(p.transportMode || 'walking');
          setIsHandicapped(!!p.isHandicapped);
          // If we have stored coords for this address, treat it as "picked"
          if (p.address && typeof p.homeLat === 'number' && typeof p.homeLng === 'number') {
            setAddressIsPicked(true);
          }
        } catch (err) {
          console.error('Failed to load settings:', err);
        }

        // Fetch building registration status — fail silently
        try {
          const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';
          if (API_URL && user?.id) {
            const res = await fetch(`${API_URL}/buildings/my/${user.id}`);
            if (res.ok) {
              const json = await res.json();
              setMyRegistration(json.registration || null);
            }
          }
        } catch {
          // ignore
        }
      })();
    }, [user?.id]),
  );

  // Cancel building registration (BSPMT17-374)
  const cancelRegistration = () => {
    if (!myRegistration || !user?.id) return;
    Alert.alert(
      'Cancel registration?',
      'Your building registration will be cancelled. You can register again later.',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel registration',
          style: 'destructive',
          onPress: async () => {
            const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';
            try {
              const res = await fetch(
                `${API_URL}/buildings/${myRegistration.id}/cancel`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ user_id: user.id }),
                },
              );
              if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                Alert.alert('Failed', j.detail || 'Could not cancel');
                return;
              }
              setMyRegistration(null);
            } catch (e: any) {
              Alert.alert('Network error', String(e?.message || e));
            }
          },
        },
      ],
    );
  };

  // Debounced Nominatim search whenever the user types in the address field
  const onAddressChange = (text: string) => {
    setAddress(text);
    // Any keystroke invalidates the previously picked suggestion (coords no
    // longer correspond to what's in the box).
    setAddressIsPicked(false);
    setHomeLat(null);
    setHomeLng(null);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();

    const q = text.trim();
    if (q.length < 3) {
      setSuggestions([]);
      setSearching(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setSearching(true);
      try {
        const url =
          'https://nominatim.openstreetmap.org/search' +
          `?q=${encodeURIComponent(q)}` +
          '&format=json' +
          '&addressdetails=1' +
          '&limit=5' +
          '&countrycodes=il'; // restrict to Israel
        const res = await fetch(url, {
          signal: ctrl.signal,
          headers: {
            'Accept': 'application/json',
            // Nominatim asks for a User-Agent identifying the app.
            'User-Agent': 'ToSafePlace/1.0',
          },
        });
        const json: NominatimResult[] = await res.json();
        setSuggestions(Array.isArray(json) ? json : []);
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.log('Nominatim error:', err);
        }
      } finally {
        setSearching(false);
      }
    }, 350);
  };

  const pickSuggestion = (r: NominatimResult) => {
    const label = formatSuggestion(r);
    setAddress(label);
    setHomeLat(parseFloat(r.lat));
    setHomeLng(parseFloat(r.lon));
    setAddressIsPicked(true);
    setSuggestions([]);
  };

  // Single save action — pushes to local storage and the backend
  const saveSettings = async () => {
    // Radius validation
    if (radius.trim() !== '') {
      const v = parseFloat(radius);
      if (isNaN(v) || v < 0) {
        Alert.alert('Invalid radius', 'Radius cannot be negative.');
        return;
      }
      if (v > 1500) {
        Alert.alert('Invalid radius', 'Radius cannot be more than 1500 meters.');
        return;
      }
    }

    // If the address has text but wasn't picked from suggestions, warn the
    // user — we'll still save the text, but coordinates will be null so the
    // home radius / "don't notify near home" logic won't apply.
    if (address.trim() !== '' && !addressIsPicked) {
      Alert.alert(
        'Address not selected',
        'You typed an address but didn\'t pick one from the suggestions. ' +
          'Saving without coordinates means home-based features won\'t work. ' +
          'Save anyway?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Save anyway', onPress: () => doSave() },
        ],
      );
      return;
    }
    doSave();
  };

  const doSave = async () => {
    const payload = {
      address,
      homeLat,
      homeLng,
      radius,
      transportMode,
      isHandicapped,
    };
    try {
      await AsyncStorage.setItem('userSettings', JSON.stringify(payload));

      const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';
      if (API_URL && user?.id) {
        fetch(`${API_URL}/api/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: user.id,
            address,
            home_lat: homeLat,
            home_lng: homeLng,
            exclusion_radius: parseFloat(radius) || 0,
            transport_mode: transportMode,
            is_handicapped: isHandicapped,
          }),
        }).catch(() => console.log('Network error, saved locally.'));
      }

      // Tell the geofence hook to re-evaluate now that home/radius may
      // have changed — otherwise it would wait for the next GPS movement.
      DeviceEventEmitter.emit(GEOFENCE_SETTINGS_CHANGED_EVENT);
      // Tell the map to re-apply its accessibility filter — the ♿ toggle on
      // the map mirrors this same `isHandicapped` flag and should flip live.
      DeviceEventEmitter.emit(ACCESSIBILITY_SETTINGS_CHANGED_EVENT);

      Alert.alert('Saved', 'Your preferences have been saved.');
    } catch {
      Alert.alert('Error', 'Failed to save settings.');
    }
  };

  const TransportButton = ({ mode, label }: { mode: string; label: string }) => (
    <TouchableOpacity
      style={[styles.transportBtn, transportMode === mode && styles.transportBtnActive]}
      onPress={() => setTransportMode(mode)}
    >
      <Text style={[styles.transportBtnText, transportMode === mode && styles.transportBtnTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  // Show the home-not-set banner when there's no address with coords saved.
  // We err on the side of telling users that they'll get all alarms — the
  // safety-critical default.
  const homeIsConfigured =
    address.trim() !== '' && homeLat != null && homeLng != null;

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: 40 }}
    >
      {/* Custom header row — Back arrow + title.
          The sidebar was removed, so screens navigate via push/back instead. */}
      <View style={styles.headerRow}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          testID="back-button"
          accessibilityLabel="Back"
        >
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.header}>Emergency Settings</Text>
        <View style={{ width: 36 }} />
      </View>

      {!homeIsConfigured && (
        <View style={styles.warningBanner}>
          <Text style={styles.warningText}>
            ⚠️ Set your home address to enable the “Do Not Notify” radius and home-based features.
            Without it you’ll receive every alarm.
          </Text>
        </View>
      )}

      {/* Address with autocomplete */}
      <View style={styles.section}>
        <Text style={styles.label}>Home Address</Text>
        <Text style={styles.subtext}>
          Start typing your street and pick a suggestion below.
        </Text>

        <View style={styles.inputWrapper}>
          <TextInput
            style={styles.input}
            placeholder="e.g., Herzl, Tel Aviv"
            value={address}
            onChangeText={onAddressChange}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {searching && (
            <ActivityIndicator
              size="small"
              color="#0a7ea4"
              style={styles.inputSpinner}
            />
          )}
        </View>

        {/* Suggestions dropdown */}
        {suggestions.length > 0 && (
          <View style={styles.suggestions}>
            {suggestions.map((r, i) => (
              <TouchableOpacity
                key={`${r.lat}-${r.lon}-${i}`}
                style={styles.suggestionRow}
                onPress={() => pickSuggestion(r)}
              >
                <Text style={styles.suggestionText} numberOfLines={2}>
                  {formatSuggestion(r)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {address.trim() !== '' && !addressIsPicked && (
          <Text style={styles.fieldWarn}>
            Please pick an address from the suggestions to enable home-based features.
          </Text>
        )}
        {addressIsPicked && (
          <Text style={styles.fieldOk}>✓ Address confirmed</Text>
        )}
      </View>

      {/* Radius */}
      <View style={styles.section}>
        <Text style={styles.label}>Do Not Notify Radius (meters)</Text>
        <Text style={styles.subtext}>
          Ignore alerts if you are within this radius from your address. Leave empty to always receive alerts.
        </Text>
        <TextInput
          style={styles.input}
          placeholder="e.g., 500"
          keyboardType="numeric"
          value={radius}
          onChangeText={setRadius}
        />
      </View>

      {/* Transportation */}
      <View style={styles.section}>
        <Text style={styles.label}>Default Transportation</Text>
        <Text style={styles.subtext}>
          When receiving an alert, this mode will be used for navigation.
        </Text>
        <View style={styles.transportRow}>
          <TransportButton mode="walking" label="Walking" />
          <TransportButton mode="cycling" label="Cycling" />
          <TransportButton mode="driving" label="Driving" />
        </View>
      </View>

      {/* Accessibility */}
      <View style={[styles.section, styles.rowSection]}>
        <View style={styles.textColumn}>
          <Text style={styles.label}>Accessible Shelter Only</Text>
          <Text style={styles.subtext}>Prioritize street-level or ramped safe zones.</Text>
        </View>
        <Switch value={isHandicapped} onValueChange={setIsHandicapped} />
      </View>

      {/* Single save button */}
      <TouchableOpacity style={styles.saveButton} onPress={saveSettings}>
        <Text style={styles.saveButtonText}>Save Preferences</Text>
      </TouchableOpacity>

      {/* Building Manager Registration (BSPMT17-371 / 374) */}
      <View style={styles.adminSection}>
        <Text style={styles.adminSectionTitle}>Building Manager</Text>
        {myRegistration ? (
          <>
            <Text style={styles.fieldOk}>
              ✅ Building registered (status: {myRegistration.registrationStatus})
            </Text>
            <TouchableOpacity
              style={[styles.logoutButton, { marginTop: 10 }]}
              onPress={cancelRegistration}
              testID="cancel-building-registration"
            >
              <Text style={styles.logoutButtonText}>Cancel Registration</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={styles.adminBtn}
            onPress={() => router.push('/building-registration' as any)}
            testID="register-building-button"
          >
            <Text style={styles.adminBtnText}>📋 Register as Building Manager</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Admin-only section. Without the sidebar there's no other entry
          point to the dashboard, so we expose it here. */}
      {user?.role === 'admin' && (
        <View style={styles.adminSection}>
          <Text style={styles.adminSectionTitle}>Admin</Text>
          <TouchableOpacity
            style={styles.adminBtn}
            onPress={() => router.push('/(tabs)/ShelterDashboard' as any)}
            testID="shelter-dashboard-button"
          >
            <Text style={styles.adminBtnText}>📋 Shelter Dashboard</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.adminBtn}
            onPress={() => router.push('/buildings-dashboard' as any)}
            testID="buildings-dashboard-button"
          >
            <Text style={styles.adminBtnText}>🏢 Buildings Dashboard</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Logout — moved here from the old Home placeholder so users can
          sign out from the centralized Settings entry point. */}
      {user?.role === 'admin' && (
        <TouchableOpacity
          style={styles.adminButton}
          onPress={() => router.push('/admin-broadcast' as any)}
          testID="admin-broadcast-button"
        >
          <Text style={styles.adminButtonText}>📣 Send message to all users</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={styles.logoutButton}
        onPress={() => logout()}
        testID="logout-button"
      >
        <Text style={styles.logoutButtonText}>🚪 Logout</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#181818', padding: 20 },
  header: { fontSize: 24, fontWeight: 'bold', color: '#333', flex: 1, textAlign: 'center' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f2f2f2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: { fontSize: 28, color: '#1a73e8', lineHeight: 30, marginTop: -2 },

  warningBanner: {
    backgroundColor: '#FFF4E5',
    borderLeftWidth: 4,
    borderLeftColor: '#FFA726',
    padding: 12,
    borderRadius: 6,
    marginBottom: 20,
  },
  warningText: { color: '#7A4A00', fontSize: 13, lineHeight: 18 },

  section: { marginBottom: 22 },
  rowSection: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  textColumn: { flex: 1, paddingRight: 10 },
  label: { fontSize: 16, fontWeight: '600', color: '#444', marginBottom: 5 },
  subtext: { fontSize: 12, color: '#666', marginBottom: 8 },

  inputWrapper: { position: 'relative' },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  inputSpinner: { position: 'absolute', right: 12, top: 14 },

  suggestions: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    marginTop: 6,
    overflow: 'hidden',
  },
  suggestionRow: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  suggestionText: { fontSize: 15, color: '#222' },

  fieldWarn: { color: '#B26A00', fontSize: 12, marginTop: 6 },
  fieldOk: { color: '#1D9E75', fontSize: 12, marginTop: 6, fontWeight: '600' },

  transportRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  transportBtn: {
    flex: 1,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#007AFF',
    borderRadius: 8,
    marginHorizontal: 4,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  transportBtnActive: { backgroundColor: '#007AFF' },
  transportBtnText: { color: '#007AFF', fontWeight: '600' },
  transportBtnTextActive: { color: '#fff' },

  saveButton: {
    backgroundColor: '#28a745',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  saveButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },

  logoutButton: {
    backgroundColor: '#e24b4a',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 30,
  },
  logoutButtonText: { color: '#fff', fontSize: 17, fontWeight: '700' },

  adminButton: {
    backgroundColor: '#0a7ea4',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  adminButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  adminSection: {
    marginTop: 24,
    paddingTop: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ddd',
  },
  adminSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },
  adminBtn: {
    backgroundColor: '#fff',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#1a73e8',
  },
  adminBtnText: { color: '#1a73e8', fontSize: 16, fontWeight: '700' },
});
