// Building Manager Registration screen (BSPMT17-371).
//
// A user fills in their building's address, apartment count, shelter
// location, and optionally uploads a permit/document (PDF or image).
// On submit the server inserts a new ShelterTest doc with isActive=false /
// isVisibleOnMap=false so it stays hidden from the map until an admin
// approves it via Shelter Dashboard.
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';

import { useAuth } from '@/context/auth';
import { OrefZonesService } from '@/services/OrefZonesService';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Screen from '@/components/ui/Screen';
import ScreenHeader from '@/components/ui/ScreenHeader';
import { Palette, Radius, Shadow, Spacing, Typography } from '@/constants/theme';

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
    neighbourhood?: string;
    suburb?: string;
  };
};

// Try hard to find a house number for this result. Nominatim sometimes
// puts it in `address.house_number`, sometimes only as the first
// comma-segment of `display_name`. Returns '' if no number is found.
function houseNumberFromResult(r: NominatimResult): string {
  const a = r.address || {};
  if (a.house_number) return a.house_number;
  // First segment of display_name is often just a number like "65"
  const firstSeg = r.display_name.split(',')[0]?.trim() || '';
  if (/^\d+[a-zA-Z]?$/.test(firstSeg)) return firstSeg;
  return '';
}

// "Street number, City" — used for the suggestion list (user picks here, so
// they need to see the city to disambiguate similarly-named streets).
function formatSuggestion(r: NominatimResult): string {
  const a = r.address || {};
  const street = a.road || a.pedestrian;
  const city = a.city || a.town || a.village || a.municipality;
  const num = houseNumberFromResult(r);
  if (street && city) {
    return num ? `${street} ${num}, ${city}` : `${street}, ${city}`;
  }
  const parts = r.display_name.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.slice(0, 2).join(', ');
}

// Street name only — saved as the editable "street" field. The house
// number is kept in a separate field so the user can correct it.
function streetOnlyFromSuggestion(r: NominatimResult): string {
  const a = r.address || {};
  const street = a.road || a.pedestrian;
  if (street) return street;
  const parts = r.display_name.split(',').map((s) => s.trim()).filter(Boolean);
  return parts[0] || '';
}

function cityFromSuggestion(r: NominatimResult): string {
  const a = r.address || {};
  return a.city || a.town || a.village || a.municipality || '';
}

function neighborhoodFromSuggestion(r: NominatimResult): string {
  const a = r.address || {};
  return a.neighbourhood || a.suburb || '';
}

export default function BuildingRegistrationScreen() {
  const { user } = useAuth();

  const [address, setAddress] = useState('');
  const [houseNumber, setHouseNumber] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [city, setCity] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [alertZone, setAlertZone] = useState('');
  const [addressPicked, setAddressPicked] = useState(false);

  const [apartmentCount, setApartmentCount] = useState('');
  const [shelterLocation, setShelterLocation] = useState('');
  const [entranceCode, setEntranceCode] = useState('');
  const [pickedFile, setPickedFile] = useState<{ name: string; base64: string } | null>(null);
  const [picking, setPicking] = useState(false);

  // Duplicate-address detection (live, debounced)
  const [addressTaken, setAddressTaken] = useState(false);
  const [checkingAddress, setCheckingAddress] = useState(false);
  const checkDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const onAddressChange = (text: string) => {
    setAddress(text);
    setAddressPicked(false);
    setLat(null);
    setLng(null);

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
        // limit=10 + dedupe → more chance the right precise match is in the list.
        // accept-language=he so Hebrew street names come back consistently.
        const url =
          'https://nominatim.openstreetmap.org/search' +
          `?q=${encodeURIComponent(q)}` +
          '&format=json&addressdetails=1&limit=10&dedupe=1' +
          '&countrycodes=il&accept-language=he';
        const res = await fetch(url, {
          signal: ctrl.signal,
          headers: { Accept: 'application/json', 'User-Agent': 'ToSafePlace/1.0' },
        });
        const json: NominatimResult[] = await res.json();
        setSuggestions(Array.isArray(json) ? json : []);
      } catch (err: any) {
        if (err?.name !== 'AbortError') console.log('Nominatim error:', err);
      } finally {
        setSearching(false);
      }
    }, 350);
  };

  const pickSuggestion = async (r: NominatimResult) => {
    const pickedLat = parseFloat(r.lat);
    const pickedLng = parseFloat(r.lon);
    // Store street name and house number separately so the user can
    // correct the number if Nominatim got it wrong / missing.
    setAddress(streetOnlyFromSuggestion(r));
    setHouseNumber(houseNumberFromResult(r));
    setLat(pickedLat);
    setLng(pickedLng);
    setCity(cityFromSuggestion(r));
    setNeighborhood(neighborhoodFromSuggestion(r));
    setAddressPicked(true);
    setSuggestions([]);

    // Resolve the Pikud HaOref alert zone for this location (silent — used
    // server-side so future alerts target this building correctly).
    try {
      await OrefZonesService.load();
      const zone = OrefZonesService.getZone(pickedLat, pickedLng);
      if (zone) setAlertZone(zone);
    } catch {
      // ignore — backend stores empty string when unknown
    }
  };

  // Live duplicate-address check. Fires whenever the picked address or
  // house number changes (debounced 400 ms). Sets `addressTaken` true if
  // someone else already has an active registration there.
  useEffect(() => {
    if (!addressPicked || !address.trim()) {
      setAddressTaken(false);
      setCheckingAddress(false);
      return;
    }
    if (checkDebounceRef.current) clearTimeout(checkDebounceRef.current);
    setCheckingAddress(true);
    checkDebounceRef.current = setTimeout(async () => {
      try {
        const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';
        if (!API_URL) return;
        const fullAddress = houseNumber.trim()
          ? `${address.trim()} ${houseNumber.trim()}`
          : address.trim();
        const url =
          `${API_URL}/buildings/check` +
          `?address=${encodeURIComponent(fullAddress)}` +
          `&city=${encodeURIComponent(city)}`;
        const res = await fetch(url);
        if (!res.ok) {
          setAddressTaken(false);
          return;
        }
        const json = await res.json();
        setAddressTaken(!!json.exists);
      } catch {
        setAddressTaken(false);
      } finally {
        setCheckingAddress(false);
      }
    }, 400);
    return () => {
      if (checkDebounceRef.current) clearTimeout(checkDebounceRef.current);
    };
  }, [addressPicked, address, houseNumber, city]);

  const pickFile = async () => {
    try {
      setPicking(true);
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      // Convert local file URI → base64 via FileReader for JSON transport.
      const fileResp = await fetch(asset.uri);
      const blob = await fileResp.blob();
      await new Promise<void>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = reader.result as string;
          const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
          setPickedFile({ name: asset.name, base64: b64 });
          resolve();
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    } catch (e: any) {
      Alert.alert('Could not read file', String(e?.message || e));
    } finally {
      setPicking(false);
    }
  };

  const submit = async () => {
    if (!user?.id) {
      Alert.alert('Not logged in', 'Please log in again.');
      return;
    }
    if (!addressPicked || lat == null || lng == null) {
      Alert.alert('Address required', 'Please pick an address from the suggestions.');
      return;
    }
    if (addressTaken) {
      Alert.alert(
        'Already registered',
        'A building registration already exists for this address. You cannot register the same building twice.',
      );
      return;
    }
    const apt = parseInt(apartmentCount, 10);
    if (isNaN(apt) || apt <= 0) {
      Alert.alert('Invalid', 'Please enter a valid number of apartments.');
      return;
    }
    if (!shelterLocation.trim()) {
      Alert.alert('Invalid', 'Please describe where the shelter is in the building.');
      return;
    }

    const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';
    if (!API_URL) {
      Alert.alert('Config error', 'API URL is not configured.');
      return;
    }

    // Re-check for duplicates at submit time. The debounced live check may
    // still be in-flight (user hit Submit quickly) or may be stale (another
    // user registered the same address after the live check ran).
    try {
      const fullAddress = houseNumber.trim()
        ? `${address.trim()} ${houseNumber.trim()}`
        : address.trim();
      const checkRes = await fetch(
        `${API_URL}/buildings/check` +
        `?address=${encodeURIComponent(fullAddress)}` +
        `&city=${encodeURIComponent(city)}`,
      );
      if (checkRes.ok) {
        const checkJson = await checkRes.json();
        if (checkJson.exists) {
          setAddressTaken(true);
          Alert.alert(
            'Already registered',
            'A building registration already exists for this address. You cannot register the same building twice.',
          );
          return;
        }
      }
    } catch {
      // Network error on the pre-check — let the server reject it if needed.
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/buildings/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          address: houseNumber.trim()
            ? `${address.trim()} ${houseNumber.trim()}`
            : address.trim(),
          lat,
          lng,
          city,
          neighborhood,
          alertZone,
          apartmentCount: apt,
          shelterLocation: shelterLocation.trim(),
          entranceCode: entranceCode.trim() || null,
          fileBase64: pickedFile?.base64 ?? null,
          fileName: pickedFile?.name ?? null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        Alert.alert('Could not register', json.detail || 'Server error');
        return;
      }
      Alert.alert(
        'Registered',
        'Your building registration was submitted. An admin will review it shortly.',
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (e: any) {
      Alert.alert('Network error', String(e?.message || e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen variant="light">
      <ScreenHeader title="Register Building" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.intro}>
          Fill in your building&apos;s details. An admin will review your registration
          before it becomes visible on the map.
        </Text>

      {/* Address */}
      <View style={styles.section}>
        <Text style={styles.label}>Building Address</Text>
        <View style={styles.inputWrapper}>
          <TextInput
            style={styles.input}
            placeholder="Start typing and pick a suggestion"
            value={address}
            onChangeText={onAddressChange}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {searching && <ActivityIndicator size="small" color={Palette.brand} style={styles.inputSpinner} />}
        </View>
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
        {addressPicked && !addressTaken && !checkingAddress && (
          <Text style={styles.fieldOk}>✓ Address confirmed</Text>
        )}
        {checkingAddress && (
          <Text style={styles.subtext}>Checking address…</Text>
        )}
        {addressTaken && (
          <Text style={styles.fieldErr}>
            ⚠️ A registration already exists for this address. You can&apos;t register the same building twice.
          </Text>
        )}
      </View>

      {/* House number — separate so the user can fix it if Nominatim missed it */}
      <View style={styles.section}>
        <Text style={styles.label}>House Number</Text>
        <Text style={styles.subtext}>
          Filled automatically when possible — edit if needed.
        </Text>
        <TextInput
          style={styles.input}
          placeholder="e.g., 65"
          keyboardType="numeric"
          value={houseNumber}
          onChangeText={setHouseNumber}
        />
      </View>

      {/* Apartment count */}
      <View style={styles.section}>
        <Text style={styles.label}>Number of Apartments</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g., 12"
          keyboardType="numeric"
          value={apartmentCount}
          onChangeText={setApartmentCount}
        />
      </View>

      {/* Entrance code (optional) */}
      <View style={styles.section}>
        <Text style={styles.label}>Building Entrance Code (optional)</Text>
        <Text style={styles.subtext}>
          Needed by emergency responders to access the building during an alert.
        </Text>
        <TextInput
          style={styles.input}
          placeholder="e.g., 1234"
          value={entranceCode}
          onChangeText={setEntranceCode}
          autoCapitalize="none"
        />
      </View>

      {/* Shelter location */}
      <View style={styles.section}>
        <Text style={styles.label}>Shelter Location in Building</Text>
        <Text style={styles.subtext}>
          e.g., &quot;Basement&quot;, &quot;Safe room floor 1&quot;
        </Text>
        <TextInput
          style={styles.input}
          placeholder="Where is the shelter?"
          value={shelterLocation}
          onChangeText={setShelterLocation}
        />
      </View>

      {/* Document upload */}
      <View style={styles.section}>
        <Text style={styles.label}>Permit / Document (optional)</Text>
        <Text style={styles.subtext}>PDF or image proving you manage this building.</Text>
        <TouchableOpacity
          style={[styles.pickBtn, picking && { opacity: 0.6 }]}
          onPress={pickFile}
          disabled={picking}
        >
          {picking ? (
            <ActivityIndicator color={Palette.brand} />
          ) : (
            <Text style={styles.pickBtnText} numberOfLines={1}>
              {pickedFile ? `📎 ${pickedFile.name}` : '📎 Pick document'}
            </Text>
          )}
        </TouchableOpacity>
        {pickedFile && (
          <TouchableOpacity onPress={() => setPickedFile(null)} style={{ marginTop: Spacing.xs }}>
            <Text style={{ color: Palette.danger, ...Typography.caption }}>Remove</Text>
          </TouchableOpacity>
        )}
      </View>

      <Button
        label="Submit Registration"
        variant="primary"
        onPress={submit}
        loading={submitting}
        disabled={submitting}
        style={styles.submitCta}
      />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop:        Spacing.md,
    paddingBottom:     Spacing.xxxl,
  },
  intro: {
    ...Typography.body,
    color: Palette.textSecondary,
    marginBottom: Spacing.lg,
    lineHeight: 20,
  },
  section: { marginBottom: Spacing.lg },
  label: {
    ...Typography.subheading,
    color: Palette.textPrimary,
    marginBottom: Spacing.xs,
  },
  subtext: {
    ...Typography.caption,
    color: Palette.textSecondary,
    marginBottom: Spacing.sm,
  },
  inputWrapper: { position: 'relative' },
  input: {
    backgroundColor: Palette.bgSubtle,
    borderWidth: 1,
    borderColor: Palette.borderSubtle,
    borderRadius: Radius.md,
    padding: Spacing.md,
    ...Typography.body,
    color: Palette.textPrimary,
  },
  inputSpinner: { position: 'absolute', right: Spacing.md, top: 14 },
  suggestions: {
    backgroundColor: Palette.card,
    borderWidth: 1,
    borderColor: Palette.borderSubtle,
    borderRadius: Radius.md,
    marginTop: Spacing.xs,
    overflow: 'hidden',
    ...Shadow.sm,
  },
  suggestionRow: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Palette.borderSubtle,
  },
  suggestionText: {
    ...Typography.body,
    color: Palette.textPrimary,
  },
  fieldOk: {
    ...Typography.caption,
    color: Palette.success,
    marginTop: Spacing.xs,
    fontWeight: '600',
  },
  fieldErr: {
    ...Typography.caption,
    color: Palette.danger,
    marginTop: Spacing.xs,
    fontWeight: '600',
    lineHeight: 18,
  },
  pickBtn: {
    backgroundColor: Palette.card,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Palette.brand,
  },
  pickBtnText: {
    ...Typography.bodyStrong,
    color: Palette.brand,
  },
  submitCta: { marginTop: Spacing.sm },
});
