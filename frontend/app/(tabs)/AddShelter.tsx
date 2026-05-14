import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator, Switch,
} from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/context/auth';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

const PLACE_TYPES = ['public shelter', 'school', 'parking', 'other'];
const ACCESS_STATUSES = ['open', 'closed', 'locked', 'unknown'];

export default function AddShelterScreen() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [area, setArea] = useState('');
  const [city, setCity] = useState("Be'er Sheva");
  const [placeType, setPlaceType] = useState('public shelter');
  const [capacity, setCapacity] = useState('');
  const [accessStatus, setAccessStatus] = useState('open');
  const [isAccessible, setIsAccessible] = useState(false);
  const [hasStairs, setHasStairs] = useState(false);
  const [petIssueReported, setPetIssueReported] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!isAdmin) {
    return (
      <View style={styles.deniedWrap}>
        <Text style={styles.deniedTitle}>🚫 Access Denied</Text>
        <Text style={styles.deniedTxt}>This page is available to admins only</Text>
      </View>
    );
  }

  const handleSubmit = async () => {
    if (!name.trim() || !address.trim()) {
      Alert.alert('Error', 'Name and address are required');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/shelters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user?.id,
          name: name.trim(),
          address: address.trim(),
          neighborhood: neighborhood.trim(),
          area: area.trim(),
          city: city.trim(),
          placeType,
          capacity: parseInt(capacity) || 0,
          accessStatus,
          isAccessible,
          hasStairs,
          petIssueReported,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        Alert.alert('Error', data.detail || 'Failed to add shelter');
        return;
      }
      Alert.alert('Success', 'Shelter added to database', [
        {
          text: 'OK',
          onPress: () => {
            // clear form and return to dashboard
            setName(''); setAddress(''); setNeighborhood(''); setArea('');
            setCapacity(''); setPlaceType('public shelter');
            setAccessStatus('open'); setIsAccessible(false);
            setHasStairs(false); setPetIssueReported(false);
            router.push('/ShelterDashboard' as never);
          },
        },
      ]);
    } catch {
      Alert.alert('Error', 'Failed to connect to server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.header}>Add New Shelter</Text>
      <Text style={styles.subHeader}>Fill in the details to add the shelter to the database</Text>

      {/* Name */}
      <Text style={styles.label}>Shelter Name *</Text>
      <TextInput style={styles.input} placeholder="e.g., Herzl St. Shelter"
        placeholderTextColor="#666" value={name} onChangeText={setName} />

      {/* Address */}
      <Text style={styles.label}>Address *</Text>
      <TextInput style={styles.input} placeholder="Street and number"
        placeholderTextColor="#666" value={address} onChangeText={setAddress} />

      {/* Neighborhood */}
      <Text style={styles.label}>Neighborhood</Text>
      <TextInput style={styles.input} placeholder="Neighborhood name"
        placeholderTextColor="#666" value={neighborhood} onChangeText={setNeighborhood} />

      {/* Area */}
      <Text style={styles.label}>Area</Text>
      <TextInput style={styles.input} placeholder="North / South / East / West"
        placeholderTextColor="#666" value={area} onChangeText={setArea} />

      {/* City */}
      <Text style={styles.label}>City</Text>
      <TextInput style={styles.input} placeholder="City"
        placeholderTextColor="#666" value={city} onChangeText={setCity} />

      {/* Place type */}
      <Text style={styles.label}>Place Type</Text>
      <View style={styles.row}>
        {PLACE_TYPES.map(t => (
          <TouchableOpacity key={t}
            style={[styles.chip, placeType === t && styles.chipOn]}
            onPress={() => setPlaceType(t)}>
            <Text style={[styles.chipTxt, placeType === t && styles.chipTxtOn]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Capacity */}
      <Text style={styles.label}>Capacity</Text>
      <TextInput style={styles.input} placeholder="Number of people"
        placeholderTextColor="#666" keyboardType="numeric"
        value={capacity} onChangeText={setCapacity} />

      {/* Access status */}
      <Text style={styles.label}>Access Status</Text>
      <View style={styles.row}>
        {ACCESS_STATUSES.map(s => (
          <TouchableOpacity key={s}
            style={[styles.chip, accessStatus === s && styles.chipOn]}
            onPress={() => setAccessStatus(s)}>
            <Text style={[styles.chipTxt, accessStatus === s && styles.chipTxtOn]}>{s}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Switches */}
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Wheelchair Accessible ♿</Text>
        <Switch value={isAccessible} onValueChange={setIsAccessible} />
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Has Stairs</Text>
        <Switch value={hasStairs} onValueChange={setHasStairs} />
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Pet Issue Reported 🐾</Text>
        <Switch value={petIssueReported} onValueChange={setPetIssueReported} />
      </View>

      {/* Submit button */}
      <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={loading}>
        {loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.submitTxt}>+ Add Shelter to Database</Text>}
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#181818' },
  content:      { padding: 20 },
  header:       { fontSize: 26, fontWeight: '700', color: '#fff', textAlign: 'left', marginBottom: 4 },
  subHeader:    { fontSize: 13, color: '#888', textAlign: 'left', marginBottom: 22 },
  label:        { fontSize: 14, color: '#bbb', textAlign: 'left', marginBottom: 6, marginTop: 12 },
  input:        { backgroundColor: '#242424', color: '#fff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, borderWidth: 0.5, borderColor: '#333', textAlign: 'left' },
  row:          { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-start' },
  chip:         { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 0.5, borderColor: '#333', backgroundColor: '#242424' },
  chipOn:       { borderColor: '#1D9E75', backgroundColor: '#1D9E7522' },
  chipTxt:      { fontSize: 13, color: '#888' },
  chipTxtOn:    { color: '#1D9E75', fontWeight: '600' },
  switchRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#242424', padding: 14, borderRadius: 10, marginTop: 10, borderWidth: 0.5, borderColor: '#333' },
  switchLabel:  { color: '#ddd', fontSize: 15 },
  submitBtn:    { backgroundColor: '#1D9E75', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 24 },
  submitTxt:    { color: '#fff', fontSize: 16, fontWeight: '700' },
  deniedWrap:   { flex: 1, backgroundColor: '#181818', justifyContent: 'center', alignItems: 'center', padding: 20 },
  deniedTitle:  { fontSize: 28, color: '#E24B4A', fontWeight: '700', marginBottom: 8 },
  deniedTxt:    { fontSize: 16, color: '#888' },
});
