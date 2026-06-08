import React, { useState, useRef, useCallback } from 'react';
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
import { router } from 'expo-router';
import { useAuth } from '@/context/auth';
import {
  GEOFENCE_SETTINGS_CHANGED_EVENT,
  ACCESSIBILITY_SETTINGS_CHANGED_EVENT,
} from '@/hooks/use-home-geofence';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Screen from '@/components/ui/Screen';
import ScreenHeader from '@/components/ui/ScreenHeader';
import { Palette, Radius, Shadow, Spacing, Typography } from '@/constants/theme';

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

  // Cancel-registration UI now lives on its own screen (cancel-registration.tsx).
  // The Settings button just navigates there.

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

  // Segmented control for the transport mode. Three pills, the active one
  // filled with the brand color. Keeps the look uniform with other "pick one
  // of N" controls we'll add elsewhere (e.g. dashboard filters).
  const TransportButton = ({ mode, label }: { mode: string; label: string }) => {
    const active = transportMode === mode;
    return (
      <TouchableOpacity
        style={[styles.transportBtn, active && styles.transportBtnActive]}
        onPress={() => setTransportMode(mode)}
        activeOpacity={0.85}
      >
        <Text style={[styles.transportBtnText, active && styles.transportBtnTextActive]}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  // Show the home-not-set banner when there's no address with coords saved.
  // We err on the side of telling users that they'll get all alarms — the
  // safety-critical default.
  const homeIsConfigured =
    address.trim() !== '' && homeLat != null && homeLng != null;

  return (
    <Screen variant="light">
      <ScreenHeader title="Emergency Settings" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {!homeIsConfigured && (
          <View style={styles.warningBanner}>
            <Text style={styles.warningText}>
              ⚠️ Set your home address to enable the “Do Not Notify” radius and home-based
              features. Without it you’ll receive every alarm.
            </Text>
          </View>
        )}

        {/* Address with autocomplete */}
        <Card>
          <Text style={styles.label}>Home Address</Text>
          <Text style={styles.subtext}>Start typing your street and pick a suggestion below.</Text>

          <View style={styles.inputWrapper}>
            <TextInput
              style={styles.input}
              placeholder="e.g., Herzl, Tel Aviv"
              placeholderTextColor={Palette.textTertiary}
              value={address}
              onChangeText={onAddressChange}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {searching && (
              <ActivityIndicator
                size="small"
                color={Palette.brand}
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
        </Card>

        {/* Radius */}
        <Card>
          <Text style={styles.label}>Do Not Notify Radius (meters)</Text>
          <Text style={styles.subtext}>
            Ignore alerts if you are within this radius from your address. Leave empty to
            always receive alerts.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="e.g., 500"
            placeholderTextColor={Palette.textTertiary}
            keyboardType="numeric"
            value={radius}
            onChangeText={setRadius}
          />
        </Card>

        {/* Transportation */}
        <Card>
          <Text style={styles.label}>Default Transportation</Text>
          <Text style={styles.subtext}>
            When receiving an alert, this mode will be used for navigation.
          </Text>
          <View style={styles.transportRow}>
            <TransportButton mode="walking" label="Walking" />
            <TransportButton mode="cycling" label="Cycling" />
            <TransportButton mode="driving" label="Driving" />
          </View>
        </Card>

        {/* Accessibility */}
        <Card>
          <View style={styles.rowSection}>
            <View style={styles.textColumn}>
              <Text style={styles.label}>Accessible Shelter Only</Text>
              <Text style={styles.subtext}>Prioritize street-level or ramped safe zones.</Text>
            </View>
            <Switch
              value={isHandicapped}
              onValueChange={setIsHandicapped}
              trackColor={{ false: Palette.borderStrong, true: Palette.brand }}
              thumbColor={Palette.card}
            />
          </View>
        </Card>

        {/* Primary CTA */}
        <Button
          label="Save Preferences"
          onPress={saveSettings}
          variant="primary"
          style={styles.primaryCta}
        />

        {/* Building Manager */}
        <Text style={styles.sectionLabel}>Building Manager</Text>
        <Card>
          {myRegistration ? (
            <>
              <Text style={styles.fieldOk}>
                ✅ Building registered (status: {myRegistration.registrationStatus})
              </Text>
              <Button
                label="Cancel Registration"
                onPress={() => router.push('/cancel-registration' as any)}
                variant="danger"
                style={styles.cardCta}
                testID="cancel-building-registration"
              />
            </>
          ) : (
            <Button
              label="Register as Building Manager"
              icon="📋"
              onPress={() => router.push('/building-registration' as any)}
              variant="secondary"
              testID="register-building-button"
            />
          )}
        </Card>

        {/* Admin */}
        {user?.role === 'admin' && (
          <>
            <Text style={styles.sectionLabel}>Admin</Text>
            <Card>
              <View style={styles.adminStack}>
                <Button
                  label="Shelter Dashboard"
                  icon="📋"
                  onPress={() => router.push('/(tabs)/ShelterDashboard' as any)}
                  variant="secondary"
                  testID="shelter-dashboard-button"
                />
                <Button
                  label="Buildings Dashboard"
                  icon="🏢"
                  onPress={() => router.push('/buildings-dashboard' as any)}
                  variant="secondary"
                  testID="buildings-dashboard-button"
                />
                <Button
                  label="Send message to all users"
                  icon="📣"
                  onPress={() => router.push('/admin-broadcast' as any)}
                  variant="primary"
                  testID="admin-broadcast-button"
                />
              </View>
            </Card>
          </>
        )}

        <Button
          label="Logout"
          icon="🚪"
          onPress={() => logout()}
          variant="danger"
          style={styles.logoutCta}
          testID="logout-button"
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll:       { flex: 1 },
  scrollContent:{
    paddingHorizontal: Spacing.lg,
    paddingTop:        Spacing.md,
    paddingBottom:     Spacing.xxxl,
  },

  warningBanner: {
    backgroundColor:  Palette.warningSoft,
    borderLeftWidth:  4,
    borderLeftColor:  Palette.warning,
    padding:          Spacing.md,
    borderRadius:     Radius.md,
    marginBottom:     Spacing.lg,
  },
  warningText: {
    ...Typography.caption,
    color: Palette.warning,
  },

  rowSection: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  textColumn: { flex: 1, paddingRight: Spacing.md },

  label: {
    ...Typography.subheading,
    color: Palette.textPrimary,
    marginBottom: Spacing.xs,
  },
  subtext: {
    ...Typography.caption,
    color: Palette.textSecondary,
    marginBottom: Spacing.md,
  },

  inputWrapper: { position: 'relative' },
  input: {
    backgroundColor: Palette.bgSubtle,
    borderWidth:     1,
    borderColor:     Palette.borderSubtle,
    borderRadius:    Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.md,
    ...Typography.body,
    color:           Palette.textPrimary,
  },
  inputSpinner: { position: 'absolute', right: Spacing.md, top: 14 },

  suggestions: {
    backgroundColor: Palette.card,
    borderWidth:     1,
    borderColor:     Palette.borderSubtle,
    borderRadius:    Radius.md,
    marginTop:       Spacing.sm,
    overflow:        'hidden',
    ...Shadow.sm,
  },
  suggestionRow: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Palette.borderSubtle,
  },
  suggestionText: {
    ...Typography.body,
    color: Palette.textPrimary,
  },

  fieldWarn: {
    ...Typography.caption,
    color: Palette.warning,
    marginTop: Spacing.sm,
  },
  fieldOk: {
    ...Typography.caption,
    color: Palette.success,
    marginTop: Spacing.sm,
    fontWeight: '600',
  },

  // Segmented control for the transport selector
  transportRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  transportBtn: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius:    Radius.md,
    borderWidth:     1.5,
    borderColor:     Palette.brand,
    backgroundColor: Palette.card,
    alignItems:      'center',
  },
  transportBtnActive: { backgroundColor: Palette.brand },
  transportBtnText: {
    ...Typography.bodyStrong,
    color: Palette.brand,
  },
  transportBtnTextActive: { color: Palette.brandOn },

  // Section-label "All caps" header that sits above an admin/manager Card
  sectionLabel: {
    ...Typography.sectionLabel,
    color:        Palette.textTertiary,
    marginTop:    Spacing.xl,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },

  primaryCta:  { marginTop: Spacing.sm, marginBottom: Spacing.sm },
  cardCta:     { marginTop: Spacing.md },
  adminStack:  { gap: Spacing.md },
  logoutCta:   { marginTop: Spacing.xl },
});
