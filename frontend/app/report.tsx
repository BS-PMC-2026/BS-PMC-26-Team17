import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import * as Location from "expo-location";

import { useAuth } from "@/context/auth";
import Screen from "@/components/ui/Screen";
import ScreenHeader from "@/components/ui/ScreenHeader";
import { Palette, Radius, Spacing, Typography } from "@/constants/theme";

const API_URL = process.env.EXPO_PUBLIC_API_URL;

const CATEGORIES: { key: string; label: string }[] = [
  { key: "access", label: "Access Issue" },
  { key: "capacity", label: "Capacity Issue" },
  { key: "cleanliness", label: "Cleanliness Issue" },
  { key: "damage", label: "Damage" },
  { key: "other", label: "Other" },
];

const TYPES_BY_CATEGORY: Record<string, { key: string; label: string }[]> = {
  access: [
    { key: "closed", label: "Shelter is Closed" },
    { key: "locked", label: "Shelter is Locked" },
    { key: "access_blocked", label: "Access is Blocked" },
  ],
  capacity: [
    { key: "full", label: "Shelter is Full" },
    { key: "overcrowded", label: "Overcrowded" },
  ],
  cleanliness: [
    { key: "dirty", label: "Shelter is Dirty" },
    { key: "health_hazard", label: "Health Hazard" },
  ],
  damage: [
    { key: "structural", label: "Structural Damage" },
    { key: "broken_equipment", label: "Broken Equipment" },
    { key: "no_power", label: "No Power / Lighting" },
  ],
  other: [
    { key: "pet_issue", label: "Pet Issue" },
    { key: "general", label: "General Issue" },
  ],
};

export default function ReportScreen() {
  const { shelterId, shelterName } = useLocalSearchParams<{
    shelterId: string;
    shelterName: string;
  }>();
  const { user } = useAuth();

  const [category, setCategory] = useState("");
  const [reportType, setReportType] = useState("");
  const [description, setDescription] = useState("");
  const [callbackNumber, setCallbackNumber] = useState(user?.telephone ?? "");
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const loc = await Location.getCurrentPositionAsync({});
        setLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      }
    })();
  }, []);

  const handleCategorySelect = (key: string) => {
    setCategory(key);
    setReportType("");
  };

  const handleSubmit = async () => {
    if (!category) {
      Alert.alert("Missing field", "Please select a report category.");
      return;
    }
    if (!reportType) {
      Alert.alert("Missing field", "Please select a report type.");
      return;
    }
    if (!shelterId) {
      Alert.alert("Error", "Shelter information is missing.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`${API_URL}/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shelterId,
          userId: user?.id ?? "",
          reportCategory: category,
          reportType,
          description: description.trim(),
          reporterLat: location?.latitude ?? null,
          reporterLng: location?.longitude ?? null,
          reporterNumber: user?.telephone ?? "",
          callbackNumber: callbackNumber.trim(),
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        Alert.alert("Error", err.detail || "Failed to submit report.");
        return;
      }

      Alert.alert("Report submitted", "Thank you for your report.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch {
      Alert.alert("Error", "Cannot connect to server.");
    } finally {
      setSubmitting(false);
    }
  };

  const availableTypes = category ? TYPES_BY_CATEGORY[category] ?? [] : [];

  return (
    <Screen variant="light">
      <ScreenHeader title="Submit Report" />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.shelterName} numberOfLines={2}>
            {shelterName || "Shelter"}
          </Text>

          <Text style={styles.sectionLabel}>Category *</Text>
          <View style={styles.chipRow}>
            {CATEGORIES.map((c) => (
              <TouchableOpacity
                key={c.key}
                style={[styles.chip, category === c.key && styles.chipSelected]}
                onPress={() => handleCategorySelect(c.key)}
                activeOpacity={0.85}
              >
                <Text style={[styles.chipText, category === c.key && styles.chipTextSelected]}>
                  {c.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {category !== "" && (
            <>
              <Text style={styles.sectionLabel}>Type *</Text>
              <View style={styles.chipRow}>
                {availableTypes.map((t) => (
                  <TouchableOpacity
                    key={t.key}
                    style={[styles.chip, reportType === t.key && styles.chipSelected]}
                    onPress={() => setReportType(t.key)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.chipText, reportType === t.key && styles.chipTextSelected]}>
                      {t.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <Text style={styles.sectionLabel}>Description (optional)</Text>
          <TextInput
            style={styles.textArea}
            placeholder="Describe the issue..."
            placeholderTextColor={Palette.textTertiary}
            multiline
            numberOfLines={4}
            value={description}
            onChangeText={setDescription}
          />

          <Text style={styles.sectionLabel}>Callback number (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="Phone number to contact you"
            placeholderTextColor={Palette.textTertiary}
            keyboardType="phone-pad"
            value={callbackNumber}
            onChangeText={setCallbackNumber}
          />

          {/* Submit button — kept as TouchableOpacity (not the shared `Button`)
              because the ActivityIndicator-on-loading flow is custom-styled
              to match the existing UX. */}
          <TouchableOpacity
            style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
            activeOpacity={0.85}
          >
            {submitting ? (
              <ActivityIndicator color={Palette.textInverse} />
            ) : (
              <Text style={styles.submitBtnText}>Submit Report</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    paddingHorizontal: Spacing.lg,
    paddingTop:        Spacing.md,
    paddingBottom:     Spacing.xxxl,
  },
  shelterName: {
    ...Typography.heading,
    color: Palette.textPrimary,
    marginBottom: Spacing.xs,
  },
  sectionLabel: {
    ...Typography.sectionLabel,
    color: Palette.textTertiary,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
    borderColor: Palette.borderSubtle,
    backgroundColor: Palette.card,
  },
  chipSelected: {
    borderColor:     Palette.brand,
    backgroundColor: Palette.brandSoft,
  },
  chipText: {
    ...Typography.body,
    color: Palette.textSecondary,
  },
  chipTextSelected: {
    color: Palette.brand,
    fontWeight: "600",
  },
  input: {
    borderWidth: 1,
    borderColor: Palette.borderSubtle,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    ...Typography.body,
    color: Palette.textPrimary,
    backgroundColor: Palette.card,
  },
  textArea: {
    borderWidth: 1,
    borderColor: Palette.borderSubtle,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    ...Typography.body,
    color: Palette.textPrimary,
    backgroundColor: Palette.card,
    minHeight: 110,
    textAlignVertical: "top",
  },
  // Submit reports as a `danger`-variant button visually — a report is a
  // destructive-sounding "something is wrong here" signal, so the red CTA
  // tracks the safety semantics.
  submitBtn: {
    marginTop: Spacing.xl,
    backgroundColor: Palette.danger,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: {
    ...Typography.subheading,
    color: Palette.textInverse,
  },
});
