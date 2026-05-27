import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, SafeAreaView,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useAuth } from '@/context/auth';

const ACCESS_LABELS: Record<string, string> = { open: 'Open', closed: 'Closed', locked: 'Locked', unknown: 'Unknown' };
const ACCESS_COLORS: Record<string, string> = { open: '#1D9E75', closed: '#E24B4A', locked: '#888780', unknown: '#BA7517' };
const CLEAN_LABELS:  Record<string, string> = { clean: 'Clean', dirty: 'Dirty', unknown: 'Unknown' };
const TYPE_LABELS:   Record<string, string> = { 'public shelter': 'Public Shelter', school: 'School', parking: 'Parking', other: 'Other' };

function timeAgo(dateStr?: string): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return 'now';
  if (mins < 60)  return `${mins} min ago`;
  if (hours < 24) return `${hours} hr ago`;
  return `${days} days ago`;
}

export default function ShelterDetailsScreen() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const p = useLocalSearchParams<{
    id?: string;
    lat: string; lng: string;
    name?: string; address?: string; neighborhood?: string; area?: string;
    city?: string; placeType?: string; capacity?: string;
    accessStatus?: string; isFull?: string; isAccessible?: string;
    hasStairs?: string; petIssueReported?: string;
    cleanlinessStatus?: string; shouldBeOpen?: string;
    lastReportAt?: string; lastReportType?: string;
  }>();

  const lat = parseFloat(p.lat || '0');
  const lng = parseFloat(p.lng || '0');

  const isFull           = p.isFull === 'true';
  const isAccessible     = p.isAccessible === 'true';
  const hasStairs        = p.hasStairs === 'true';
  const petIssueReported = p.petIssueReported === 'true';
  const shouldBeOpen     = p.shouldBeOpen === 'true';

  const navigate = () => {
    router.push(
      `/navigate?lat=${lat}&lng=${lng}&name=${encodeURIComponent(p.name || 'Shelter')}`,
    );
  };

  const report = () => {
    // /report isn't a typed route yet — cast until the file is added.
    router.push(
      `/report?shelterId=${p.id || ''}&shelterName=${encodeURIComponent(p.name || 'Shelter')}` as any,
    );
  };

  const update = () => {
    router.push(`/ShelterDashboard?search=${encodeURIComponent(p.name || '')}`);
  };

  return (
    <SafeAreaView style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Text style={s.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>Shelter Details</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        <Text style={s.title} numberOfLines={3}>{p.name || 'Shelter'}</Text>

        {/* Quick icons */}
        <View style={s.iconRow}>
          {isAccessible && !hasStairs && <Text style={s.bigIcon}>♿</Text>}
          {!petIssueReported && <Text style={s.bigIcon}>🐾</Text>}
        </View>

        {/* Status badges */}
        <View style={s.badgeRow}>
          <View style={[s.badge, {
            borderColor:     ACCESS_COLORS[p.accessStatus || 'unknown'] + '88',
            backgroundColor: ACCESS_COLORS[p.accessStatus || 'unknown'] + '22',
          }]}>
            <Text style={[s.badgeTxt, { color: ACCESS_COLORS[p.accessStatus || 'unknown'] }]}>
              {ACCESS_LABELS[p.accessStatus || 'unknown']}
            </Text>
          </View>

          <View style={[s.badge, {
            borderColor:     (isFull ? '#E24B4A' : '#1D9E75') + '88',
            backgroundColor: (isFull ? '#E24B4A' : '#1D9E75') + '22',
          }]}>
            <Text style={[s.badgeTxt, { color: isFull ? '#E24B4A' : '#1D9E75' }]}>
              {isFull ? 'Full' : 'Available'}
            </Text>
          </View>
        </View>

        {/* Data rows */}
        <Row label="Address"        value={p.address || '—'} />
        <Row label="Neighborhood"   value={p.neighborhood || '—'} />
        <Row label="Area"           value={p.area || '—'} />
        <Row label="City"           value={p.city || '—'} />
        <Row label="Type"           value={TYPE_LABELS[p.placeType || ''] || p.placeType || '—'} />
        <Row label="Capacity"       value={p.capacity || '—'} />
        <Row label="Cleanliness"    value={CLEAN_LABELS[p.cleanlinessStatus || 'unknown']} />
        <Row label="Should Be Open" value={shouldBeOpen ? '✓ Yes' : '✗ No'} />
        <Row label="Has Stairs"     value={hasStairs ? 'Yes' : 'No'} />
        <Row label="Accessible"     value={isAccessible ? 'Yes' : 'No'} />
        <Row label="Last Report"    value={timeAgo(p.lastReportAt)} />
        {p.lastReportType ? <Row label="Report Type" value={p.lastReportType} /> : null}

        <View style={{ height: 30 }} />
      </ScrollView>

      <View style={s.actions}>
        <TouchableOpacity style={[s.navBtn, s.actionBtn]} onPress={navigate}>
          <Text style={s.navBtnText}>🧭 Navigate</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.reportBtn, s.actionBtn]} onPress={report}>
          <Text style={s.reportBtnText}>⚠️ Report</Text>
        </TouchableOpacity>
        {isAdmin && (
          <TouchableOpacity style={[s.updateBtn, s.actionBtn]} onPress={update}>
            <Text style={s.updateBtnText}>✏️ Update</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.dataRow}>
      <Text style={s.dataLabel}>{label}</Text>
      <Text style={s.dataValue} numberOfLines={3}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#fff' },
  header:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  backBtn:     { padding: 6, width: 30 },
  backIcon:    { fontSize: 32, color: '#1a73e8', lineHeight: 32 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: '#222' },

  scroll:        { flex: 1 },
  scrollContent: { padding: 20 },
  title:         { fontSize: 24, fontWeight: '700', color: '#222', marginBottom: 14 },
  iconRow:       { flexDirection: 'row', gap: 8, marginBottom: 14 },
  bigIcon:       { fontSize: 26 },
  badgeRow:      { flexDirection: 'row', gap: 8, marginBottom: 22, flexWrap: 'wrap' },
  badge:         { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  badgeTxt:      { fontSize: 14, fontWeight: '600' },

  dataRow:   { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  dataLabel: { width: 140, fontSize: 14, color: '#888', fontWeight: '500' },
  dataValue: { flex: 1, fontSize: 15, color: '#222' },

  actions:    { flexDirection: 'row', gap: 8, padding: 16, borderTopWidth: 0.5, borderTopColor: '#eee' },
  actionBtn:  { flex: 1 },
  navBtn:     { backgroundColor: '#1a73e8', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  navBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  reportBtn:  { backgroundColor: '#fff', paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1.5, borderColor: '#E24B4A' },
  reportBtnText: { color: '#E24B4A', fontSize: 15, fontWeight: '700' },
  updateBtn:  { backgroundColor: '#fff', paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1.5, borderColor: '#378ADD' },
  updateBtnText: { color: '#378ADD', fontSize: 15, fontWeight: '700' },
});
