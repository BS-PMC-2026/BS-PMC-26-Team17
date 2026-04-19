import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  TextInput, 
  Switch, 
  TouchableOpacity, 
  StyleSheet, 
  ScrollView,
  Alert
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function SettingsScreen() {
  const [address, setAddress] = useState('');
  const [radius, setRadius] = useState('');
  const [transportMode, setTransportMode] = useState('walking');
  const [isHandicapped, setIsHandicapped] = useState(false);

  // Load settings when the screen mounts
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const savedSettings = await AsyncStorage.getItem('userSettings');
        if (savedSettings) {
          const parsed = JSON.parse(savedSettings);
          setAddress(parsed.address || '');
          setRadius(parsed.radius || '');
          setTransportMode(parsed.transportMode || 'walking');
          setIsHandicapped(parsed.isHandicapped || false);
        }
} catch (error) {
  console.error("THE EXACT ERROR IS:", error); // <-- Add this line
  Alert.alert("Error", "Failed to save settings.");
}
    };
    loadSettings();
  }, []);

  // Save settings locally and sync to backend
  const saveSettings = async () => {
    const settingsData = { address, radius, transportMode, isHandicapped };
    
    try {
      // Save locally
      await AsyncStorage.setItem('userSettings', JSON.stringify(settingsData));
      
      // Sync to Python Backend
      fetch('https://your-python-backend.com/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: 'user_123', // Replace with real user ID
          address: address,
          exclusion_radius: parseFloat(radius) || 0,
          transport_mode: transportMode,
          is_handicapped: isHandicapped
        })
      }).catch(err => console.log("Network error, sync will happen later."));

      Alert.alert("Success", "Settings saved successfully.");
    } catch (error) {
      Alert.alert("Error", "Failed to save settings.");
    }
  };

  
const TransportButton = ({ mode, label }: { mode: string, label: string }) => (
    <TouchableOpacity
      style={[styles.transportBtn, transportMode === mode && styles.transportBtnActive]}
      onPress={() => setTransportMode(mode)}
    >
      <Text style={[styles.transportBtnText, transportMode === mode && styles.transportBtnTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.header}>Emergency Settings</Text>

      {/* Address Input */}
      <View style={styles.section}>
        <Text style={styles.label}>Home Address</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter your full address"
          value={address}
          onChangeText={setAddress}
        />
      </View>

      {/* Notification Exclusion Radius */}
      <View style={styles.section}>
        <Text style={styles.label}>Do Not Notify Radius (meters)</Text>
        <Text style={styles.subtext}>Ignore alerts if you are within this radius from your address.</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g., 500"
          keyboardType="numeric"
          value={radius}
          onChangeText={setRadius}
        />
      </View>

      {/* Transportation Mode */}
      <View style={styles.section}>
        <Text style={styles.label}>Default Transportation</Text>
        <Text style={styles.subtext}>When receiving an alert, this mode will be used for navigation.</Text>
        <View style={styles.transportRow}>
          <TransportButton mode="walking" label="Walking" />
          <TransportButton mode="cycling" label="Cycling" />
          <TransportButton mode="driving" label="Driving" />
        </View>
      </View>

      {/* Accessibility Switch */}
      <View style={[styles.section, styles.rowSection]}>
        <View style={styles.textColumn}>
          <Text style={styles.label}>Accessible Shelter Only.</Text>
          <Text style={styles.subtext}>Prioritize street-level or ramped safe zones.</Text>
        </View>
        <Switch
          value={isHandicapped}
          onValueChange={setIsHandicapped}
        />
      </View>

      {/* Save Button */}
      <TouchableOpacity style={styles.saveButton} onPress={saveSettings}>
        <Text style={styles.saveButtonText}>Save Preferences</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 20 },
  header: { fontSize: 24, fontWeight: 'bold', marginBottom: 25, color: '#333' },
  section: { marginBottom: 25 },
  rowSection: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  textColumn: { flex: 1, paddingRight: 10 },
  label: { fontSize: 16, fontWeight: '600', color: '#444', marginBottom: 5 },
  subtext: { fontSize: 12, color: '#666', marginBottom: 8 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, fontSize: 16 },
  transportRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  transportBtn: { flex: 1, paddingVertical: 10, borderWidth: 1, borderColor: '#007AFF', borderRadius: 8, marginHorizontal: 4, alignItems: 'center', backgroundColor: '#fff' },
  transportBtnActive: { backgroundColor: '#007AFF' },
  transportBtnText: { color: '#007AFF', fontWeight: '600' },
  transportBtnTextActive: { color: '#fff' },
  saveButton: { backgroundColor: '#28a745', padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10, marginBottom: 40 },
  saveButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
});