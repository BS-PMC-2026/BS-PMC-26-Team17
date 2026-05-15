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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/auth';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [address, setAddress] = useState('');
  const [radius, setRadius] = useState('');
  const [transportMode, setTransportMode] = useState('walking');
  const [isHandicapped, setIsHandicapped] = useState(false);
  const [isEditingAddress, setIsEditingAddress] = useState(false);
  const [tempAddress, setTempAddress] = useState('');
  const [isEditingRadius, setIsEditingRadius] = useState(false);
  const [tempRadius, setTempRadius] = useState('');

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
        console.error('Failed to load settings:', error);
      }
    };
    loadSettings();
  }, []);

  const handleEditAddress = () => {
    setTempAddress(address);
    setIsEditingAddress(true);
  };

  const handleSaveAddress = async () => {
    setAddress(tempAddress);
    setIsEditingAddress(false);
    // Save immediately to storage
    try {
      const savedSettings = await AsyncStorage.getItem('userSettings');
      const parsed = savedSettings ? JSON.parse(savedSettings) : {};
      await AsyncStorage.setItem('userSettings', JSON.stringify({ ...parsed, address: tempAddress }));
      Alert.alert('Saved', 'Address updated successfully.');
    } catch {
      Alert.alert('Error', 'Failed to save address.');
    }
  };

  const handleCancelAddress = () => {
    setTempAddress('');
    setIsEditingAddress(false);
  };

  const handleEditRadius = () => {
    setTempRadius(radius);
    setIsEditingRadius(true);
  };

  const handleSaveRadius = async () => {
    const value = parseFloat(tempRadius);
    if (isNaN(value) || value < 0) {
      Alert.alert('Invalid', 'Radius cannot be negative.');
      return;
    }
    if (value > 1500) {
      Alert.alert('Invalid', 'Radius cannot be more than 1500 meters.');
      return;
    }
    setRadius(tempRadius);
    setIsEditingRadius(false);
    try {
      const savedSettings = await AsyncStorage.getItem('userSettings');
      const parsed = savedSettings ? JSON.parse(savedSettings) : {};
      await AsyncStorage.setItem('userSettings', JSON.stringify({ ...parsed, radius: tempRadius }));
      Alert.alert('Saved', 'Radius updated successfully.');
    } catch {
      Alert.alert('Error', 'Failed to save radius.');
    }
  };

  const handleCancelRadius = () => {
    setTempRadius('');
    setIsEditingRadius(false);
  };

  // Save all settings
  const saveSettings = async () => {
    const settingsData = { address, radius, transportMode, isHandicapped };
    try {
      await AsyncStorage.setItem('userSettings', JSON.stringify(settingsData));

      const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';
      if (API_URL && user?.id) {
        fetch(`${API_URL}/api/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: user.id,
            address,
            exclusion_radius: parseFloat(radius) || 0,
            transport_mode: transportMode,
            is_handicapped: isHandicapped,
          }),
        }).catch(() => console.log('Network error, saved locally.'));
      }

      Alert.alert('Success', 'Settings saved successfully.');
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

  return (
    <ScrollView style={[styles.container, { paddingTop: insets.top }]} keyboardShouldPersistTaps="handled">
      <Text style={styles.header}>Emergency Settings</Text>

      {/* Address Section */}
      <View style={styles.section}>
        <Text style={styles.label}>Home Address</Text>

        {isEditingAddress ? (
          <>
            <TextInput
              style={styles.input}
              placeholder="Enter your full address"
              value={tempAddress}
              onChangeText={setTempAddress}
              autoFocus
            />
            <View style={styles.editButtonRow}>
              <TouchableOpacity style={styles.saveAddressBtn} onPress={handleSaveAddress}>
                <Text style={styles.saveAddressBtnText}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancelBtn} onPress={handleCancelAddress}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <View style={styles.addressRow}>
            <Text style={styles.addressText}>
              {address ? address : 'No address saved yet'}
            </Text>
            <TouchableOpacity style={styles.editBtn} onPress={handleEditAddress}>
              <Text style={styles.editBtnText}>Edit</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Notification Exclusion Radius */}
      <View style={styles.section}>
        <Text style={styles.label}>Do Not Notify Radius (meters)</Text>
        <Text style={styles.subtext}>Ignore alerts if you are within this radius from your address.</Text>

        {isEditingRadius ? (
          <>
            <TextInput
              style={styles.input}
              placeholder="e.g., 500"
              keyboardType="numeric"
              value={tempRadius}
              onChangeText={setTempRadius}
              autoFocus
            />
            <View style={styles.editButtonRow}>
              <TouchableOpacity style={styles.saveAddressBtn} onPress={handleSaveRadius}>
                <Text style={styles.saveAddressBtnText}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancelBtn} onPress={handleCancelRadius}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <View style={styles.addressRow}>
            <Text style={styles.addressText}>
              {radius ? `${radius} meters` : 'No radius set yet'}
            </Text>
            <TouchableOpacity style={styles.editBtn} onPress={handleEditRadius}>
              <Text style={styles.editBtnText}>Edit</Text>
            </TouchableOpacity>
          </View>
        )}
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
        <Switch value={isHandicapped} onValueChange={setIsHandicapped} />
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
  addressRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12 },
  addressText: { fontSize: 16, color: '#333', flex: 1 },
  editBtn: { backgroundColor: '#0a7ea4', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6, marginLeft: 10 },
  editBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  editButtonRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  saveAddressBtn: { flex: 1, backgroundColor: '#28a745', padding: 10, borderRadius: 8, alignItems: 'center' },
  saveAddressBtnText: { color: '#fff', fontWeight: '600' },
  cancelBtn: { flex: 1, backgroundColor: '#ddd', padding: 10, borderRadius: 8, alignItems: 'center' },
  cancelBtnText: { color: '#333', fontWeight: '600' },
  transportRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  transportBtn: { flex: 1, paddingVertical: 10, borderWidth: 1, borderColor: '#007AFF', borderRadius: 8, marginHorizontal: 4, alignItems: 'center', backgroundColor: '#fff' },
  transportBtnActive: { backgroundColor: '#007AFF' },
  transportBtnText: { color: '#007AFF', fontWeight: '600' },
  transportBtnTextActive: { color: '#fff' },
  saveButton: { backgroundColor: '#28a745', padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10, marginBottom: 40 },
  saveButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
});
