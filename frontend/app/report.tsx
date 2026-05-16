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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { useAuth } from "@/context/auth";

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
  const insets = useSafeAreaInsets();

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
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      {/* Fixed header — always reachable, respects notch/Dynamic Island */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Submit Report</Text>
        <TouchableOpacity
          style={styles.exitBtn}
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.exitBtnText}>✕</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 32 }]}
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
            placeholderTextColor="#999"
            multiline
            numberOfLines={4}
            value={description}
            onChangeText={setDescription}
          />

          <Text style={styles.sectionLabel}>Callback number (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="Phone number to contact you"
            placeholderTextColor="#999"
            keyboardType="phone-pad"
            value={callbackNumber}
            onChangeText={setCallbackNumber}
          />

          <TouchableOpacity
            style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitBtnText}>Submit Report</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#f5f6fa" },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#222",
  },
  exitBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#f0f0f0",
    alignItems: "center",
    justifyContent: "center",
  },
  exitBtnText: {
    fontSize: 16,
    color: "#555",
    lineHeight: 20,
  },

  container: {
    padding: 20,
  },
  shelterName: {
    fontSize: 18,
    fontWeight: "700",
    color: "#222",
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#555",
    marginBottom: 10,
    marginTop: 20,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: "#ccc",
    backgroundColor: "#fff",
  },
  chipSelected: {
    borderColor: "#1a73e8",
    backgroundColor: "#e8f0fe",
  },
  chipText: {
    fontSize: 15,
    color: "#555",
  },
  chipTextSelected: {
    color: "#1a73e8",
    fontWeight: "600",
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: "#222",
    backgroundColor: "#fff",
  },
  textArea: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: "#222",
    backgroundColor: "#fff",
    minHeight: 110,
    textAlignVertical: "top",
  },
  submitBtn: {
    marginTop: 32,
    backgroundColor: "#E24B4A",
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: "center",
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitBtnText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
});
