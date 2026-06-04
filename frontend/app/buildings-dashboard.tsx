import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Modal, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '@/context/auth';
import { WebView } from 'react-native-webview';
import { Platform } from 'react-native';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

type Building = {
  id: string;
  address: string;
  city: string;
  managerName?: string;
  managerUserId?: string;
  registrationStatus: 'pending' | 'approved' | 'rejected';
  entranceCode?: string;
  // Server now sends a `hasFile` boolean + the filename only. The actual
  // bytes are fetched on demand via GET /buildings/{id}/file.
  hasFile?: boolean;
  registrationFileName?: string;
  apartmentCount?: number;
  shelterLocation?: string;
  neighborhood?: string;
  createdAt?: string;
};

type Filter = 'All' | 'pending' | 'approved' | 'rejected';

const STATUS_COLORS: Record<string, string> = {
  pending:  '#BA7517',
  approved: '#1D9E75',
  rejected: '#E24B4A',
};
const STATUS_LABELS: Record<string, string> = {
  pending:  'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] || '#888';
  return (
    <View style={[badge.wrap, { borderColor: color + '66', backgroundColor: color + '18' }]}>
      <View style={[badge.dot, { backgroundColor: color }]} />
      <Text style={[badge.txt, { color }]}>{STATUS_LABELS[status] || status}</Text>
    </View>
  );
}
const badge = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 14, borderWidth: 0.5,
    alignSelf: 'center',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  txt: { fontSize: 12, fontWeight: '500' },
});

export default function BuildingsDashboard() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [buildings, setBuildings] = useState<Building[]>([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState<Filter>('All');
  const [approving, setApproving] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);

  // Detail modal
  const [selected, setSelected]   = useState<Building | null>(null);
  // The building whose document is being viewed in the in-app PDF modal.
  const [viewing,  setViewing]    = useState<Building | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res  = await fetch(`${API_URL}/buildings?user_id=${user?.id}`);
      const json = await res.json();
      setBuildings(json.buildings || json || []);
    } catch (e) {
      console.error('[BuildingsDashboard] fetch failed:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);

  const approve = async (building: Building) => {
    Alert.alert(
      'Approve Building',
      `Approve registration for:\n${building.address}, ${building.city}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            setApproving(building.id);
            try {
              const res = await fetch(`${API_URL}/buildings/${building.id}/approve`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: user?.id }),
              });
              if (!res.ok) {
                const err = await res.json();
                Alert.alert('Error', err.detail || 'Failed to approve');
                return;
              }
              setBuildings(prev =>
                prev.map(b => b.id === building.id
                  ? { ...b, registrationStatus: 'approved' }
                  : b
                )
              );
            } catch {
              Alert.alert('Error', 'Failed to connect to server');
            } finally {
              setApproving(null);
            }
          },
        },
      ],
    );
  };

  const reject = async (building: Building) => {
    Alert.alert(
      'Reject Building',
      `Reject registration for:\n${building.address}, ${building.city}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            setRejecting(building.id);
            try {
              const res = await fetch(`${API_URL}/buildings/${building.id}/reject`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: user?.id }),
              });
              if (!res.ok) {
                const err = await res.json();
                Alert.alert('Error', err.detail || 'Failed to reject');
                return;
              }
              setBuildings(prev =>
                prev.map(b => b.id === building.id
                  ? { ...b, registrationStatus: 'rejected' }
                  : b
                )
              );
            } catch {
              Alert.alert('Error', 'Failed to connect to server');
            } finally {
              setRejecting(null);
            }
          },
        },
      ],
    );
  };

  const openForm = (building: Building) => {
    if (!building.hasFile) {
      Alert.alert('No document', 'No permit document was uploaded for this building.');
      return;
    }
    setSelected(null); // close the detail modal so the viewer takes over
    setViewing(building);
  };

  // URL of the document for the in-app viewer. Android WebView can't render
  // PDFs natively, so we wrap them with Google Docs viewer there.
  const viewerUrl = (() => {
    if (!viewing) return '';
    const raw = `${API_URL}/buildings/${viewing.id}/file?user_id=${user?.id}`;
    const isPdf = (viewing.registrationFileName || '').toLowerCase().endsWith('.pdf');
    if (Platform.OS === 'android' && isPdf) {
      return `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(raw)}`;
    }
    return raw;
  })();

  const filtered = useMemo(() => {
    if (filter === 'All') return buildings;
    return buildings.filter(b => b.registrationStatus === filter);
  }, [buildings, filter]);

  const totalCount    = buildings.length;
  const pendingCount  = buildings.filter(b => b.registrationStatus === 'pending').length;
  const approvedCount = buildings.filter(b => b.registrationStatus === 'approved').length;
  const rejectedCount = buildings.filter(b => b.registrationStatus === 'rejected').length;

  if (!isAdmin) {
    return (
      <View style={s.denied}>
        <Text style={s.deniedText}>Access denied</Text>
      </View>
    );
  }

  return (
    <View style={[s.container, { paddingTop: Math.max(0, insets.top - 10) }]}>
      {/* Header */}
      <View style={s.topHeaderRow}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} testID="back-button">
          <Text style={s.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={s.topHeaderTitle}>Buildings Dashboard</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Stats */}
      <View style={s.statsRow}>
        {[
          { label: 'Pending',  value: pendingCount,  color: '#BA7517', main: false },
          { label: 'Approved', value: approvedCount, color: '#1D9E75', main: false },
          { label: 'Rejected', value: rejectedCount, color: '#E24B4A', main: false },
          { label: 'Total',    value: totalCount,    color: '#fff',    main: true  },
        ].map(c => (
          <View key={c.label} style={[s.statCard, c.main && s.statMain]}>
            <Text style={s.statLabel}>{c.label}</Text>
            <Text style={[s.statValue, { color: c.color }]}>{c.value}</Text>
          </View>
        ))}
      </View>

      {/* Filter buttons */}
      <View style={s.filterRow}>
        {(['All', 'pending', 'approved', 'rejected'] as Filter[]).map(f => {
          const active = filter === f;
          const label  = f === 'All' ? 'All' : STATUS_LABELS[f];
          return (
            <TouchableOpacity
              key={f}
              style={[s.filterBtn, active && s.filterBtnOn]}
              onPress={() => setFilter(f)}
              testID={`filter-${f}`}
            >
              <Text style={[s.filterBtnTxt, active && s.filterBtnTxtOn]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Table */}
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color="#378ADD" />
      ) : filtered.length === 0 ? (
        <Text style={s.empty}>No buildings found</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator style={{ flex: 1 }}>
          <View style={{ minWidth: 840 }}>
            {/* Table header */}
            <View style={s.tableHeader}>
              {[
                { label: 'Address',       w: 160 },
                { label: 'City',          w: 100 },
                { label: 'Manager',       w: 130 },
                { label: 'Status',        w: 100 },
                { label: 'Entrance Code', w: 110 },
                { label: 'Actions',       w: 240 },
              ].map(col => (
                <Text key={col.label} style={[s.headerCell, { width: col.w }]}>
                  {col.label}
                </Text>
              ))}
            </View>

            {/* Data rows */}
            <ScrollView style={{ maxHeight: 480 }} nestedScrollEnabled>
              {filtered.map((item, i) => (
                <View key={item.id} style={[s.row, i % 2 === 0 && s.rowAlt]}>
                  {/* Address */}
                  <TouchableOpacity
                    style={{ width: 160, paddingHorizontal: 4 }}
                    onPress={() => setSelected(item)}
                  >
                    <Text style={s.cellBold} numberOfLines={2}>{item.address}</Text>
                  </TouchableOpacity>

                  {/* City */}
                  <Text style={[s.cell, { width: 100 }]} numberOfLines={1}>
                    {item.city || '—'}
                  </Text>

                  {/* Manager name */}
                  <Text style={[s.cell, { width: 130 }]} numberOfLines={1}>
                    {item.managerName || '—'}
                  </Text>

                  {/* Status */}
                  <View style={[s.cellCenter, { width: 100 }]}>
                    <StatusBadge status={item.registrationStatus} />
                  </View>

                  {/* Entrance code */}
                  <Text style={[s.cell, { width: 110 }]} numberOfLines={1}>
                    {item.entranceCode || '—'}
                  </Text>

                  {/* Actions */}
                  <View style={[s.actionsCell, { width: 240 }]}>
                    {item.registrationStatus === 'pending' && (
                      <>
                        <TouchableOpacity
                          style={s.approveBtn}
                          onPress={() => approve(item)}
                          disabled={approving === item.id || rejecting === item.id}
                          testID={`approve-${item.id}`}
                        >
                          {approving === item.id
                            ? <ActivityIndicator size="small" color="#fff" />
                            : <Text style={s.approveBtnTxt}>✓</Text>
                          }
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={s.rejectBtn}
                          onPress={() => reject(item)}
                          disabled={rejecting === item.id || approving === item.id}
                          testID={`reject-${item.id}`}
                        >
                          {rejecting === item.id
                            ? <ActivityIndicator size="small" color="#fff" />
                            : <Text style={s.rejectBtnTxt}>✕</Text>
                          }
                        </TouchableOpacity>
                      </>
                    )}
                    <TouchableOpacity
                      style={s.viewBtn}
                      onPress={() => openForm(item)}
                      testID={`view-form-${item.id}`}
                    >
                      <Text style={s.viewBtnTxt}>📄 Form</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </ScrollView>
      )}

      <Text style={s.countLabel}>Showing {filtered.length} building{filtered.length !== 1 ? 's' : ''}</Text>

      {/* Detail Modal */}
      <Modal
        visible={!!selected}
        animationType="slide"
        onRequestClose={() => setSelected(null)}
      >
        <View style={[md.container, { paddingTop: insets.top }]}>
          <View style={md.header}>
            <View style={{ flex: 1 }}>
              <Text style={md.title} numberOfLines={1}>{selected?.address}</Text>
              <Text style={md.sub}>{selected?.city}{selected?.neighborhood ? `, ${selected.neighborhood}` : ''}</Text>
            </View>
            <TouchableOpacity style={md.closeBtn} onPress={() => setSelected(null)}>
              <Text style={md.closeTxt}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={md.body}>
            {[
              { label: 'Manager',          value: selected?.managerName || selected?.managerUserId },
              { label: 'Status',           value: selected?.registrationStatus },
              { label: 'Entrance Code',    value: selected?.entranceCode },
              { label: 'Apartments',       value: selected?.apartmentCount?.toString() },
              { label: 'Shelter Location', value: selected?.shelterLocation },
              { label: 'Registered At',    value: selected?.createdAt
                  ? new Date(selected.createdAt).toLocaleString() : undefined },
            ].map(row => row.value ? (
              <View key={row.label} style={md.row}>
                <Text style={md.rowLabel}>{row.label}</Text>
                <Text style={md.rowValue}>{row.value}</Text>
              </View>
            ) : null)}

            <TouchableOpacity
              style={md.formBtn}
              onPress={() => selected && openForm(selected)}
            >
              <Text style={md.formBtnTxt}>📄 View Permit Document</Text>
            </TouchableOpacity>

            {selected?.registrationStatus === 'pending' && (
              <TouchableOpacity
                style={md.approveFullBtn}
                onPress={() => { setSelected(null); selected && approve(selected); }}
              >
                <Text style={md.approveFullBtnTxt}>✓ Approve This Building</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* In-app document viewer (PDFs / images) */}
      <Modal
        visible={!!viewing}
        animationType="slide"
        onRequestClose={() => setViewing(null)}
      >
        <View style={{ flex: 1, backgroundColor: '#181818', paddingTop: insets.top }}>
          <View style={pdfStyles.header}>
            <TouchableOpacity onPress={() => setViewing(null)} style={pdfStyles.backBtn}>
              <Text style={pdfStyles.backIcon}>‹</Text>
              <Text style={pdfStyles.backTxt}>Back</Text>
            </TouchableOpacity>
          </View>
          {viewing && (
            <WebView
              source={{ uri: viewerUrl }}
              style={{ flex: 1, backgroundColor: '#fff' }}
              originWhitelist={['*']}
              startInLoadingState
              renderLoading={() => (
                <View style={pdfStyles.loading}>
                  <ActivityIndicator size="large" color="#0a7ea4" />
                </View>
              )}
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

const pdfStyles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: '#222',
  },
  backBtn: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 10,
  },
  backIcon: { color: '#1a73e8', fontSize: 28, lineHeight: 30, marginTop: -2, marginRight: 4 },
  backTxt: { color: '#1a73e8', fontSize: 16, fontWeight: '700' },
  loading: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff',
  },
});

const s = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#181818', padding: 14, paddingTop: 1 },
  denied:         { flex: 1, backgroundColor: '#181818', alignItems: 'center', justifyContent: 'center' },
  deniedText:     { color: '#E24B4A', fontSize: 20, fontWeight: '700' },

  topHeaderRow:   { flexDirection: 'row', alignItems: 'center', marginBottom: 12, marginTop: 4 },
  backBtn:        { width: 36, height: 36, borderRadius: 18, backgroundColor: '#2a2a2a', alignItems: 'center', justifyContent: 'center' },
  backIcon:       { fontSize: 28, color: '#fff', lineHeight: 30, marginTop: -2 },
  topHeaderTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: '#fff' },

  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 18, marginTop: -8 },
  statCard: {
    flex: 1, height: 100, backgroundColor: '#242424', borderRadius: 16,
    paddingHorizontal: 8, paddingTop: 8, paddingBottom: 14,
    alignItems: 'center', justifyContent: 'flex-end', gap: 8,
    borderWidth: 0.5, borderColor: '#333',
  },
  statMain:  { flex: 1.3, borderColor: '#444' },
  statLabel: { fontSize: 12, color: '#666', textAlign: 'center', height: 32 },
  statValue: { fontSize: 28, fontWeight: '500' },

  filterRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  filterBtn: {
    paddingHorizontal: 18, paddingVertical: 10, borderRadius: 24,
    borderWidth: 0.5, borderColor: '#444', backgroundColor: '#2a2a2a',
  },
  filterBtnOn:    { borderColor: '#999', backgroundColor: '#3d3d3d' },
  filterBtnTxt:   { fontSize: 15, color: '#aaa' },
  filterBtnTxtOn: { color: '#fff', fontWeight: '600' },

  tableHeader: {
    flexDirection: 'row', backgroundColor: '#242424',
    borderTopLeftRadius: 12, borderTopRightRadius: 12,
    borderWidth: 0.5, borderColor: '#333', paddingVertical: 12,
  },
  headerCell: { fontSize: 13, color: '#888', fontWeight: '500', textAlign: 'center', paddingHorizontal: 4, paddingVertical: 10 },

  row:     { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#222', backgroundColor: '#1c1c1c', alignItems: 'center', minHeight: 64 },
  rowAlt:  { backgroundColor: '#1f1f1f' },
  cell:    { fontSize: 13, color: '#ccc', paddingHorizontal: 4, textAlign: 'center' },
  cellBold:   { fontSize: 13, color: '#fff', fontWeight: '500', paddingHorizontal: 4 },
  cellCenter: { paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },

  actionsCell: { flexDirection: 'row', gap: 6, paddingHorizontal: 4, alignItems: 'center' },
  approveBtn: {
    backgroundColor: '#1D9E75', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6, minWidth: 36, alignItems: 'center',
  },
  approveBtnTxt: { color: '#fff', fontSize: 14, fontWeight: '700' },
  rejectBtn: {
    backgroundColor: '#E24B4A', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6, minWidth: 36, alignItems: 'center',
  },
  rejectBtnTxt: { color: '#fff', fontSize: 14, fontWeight: '700' },
  viewBtn: {
    backgroundColor: '#2a2a2a', borderRadius: 8, borderWidth: 0.5, borderColor: '#555',
    paddingHorizontal: 10, paddingVertical: 6, alignItems: 'center',
  },
  viewBtnTxt: { color: '#ccc', fontSize: 12, fontWeight: '600' },

  empty:      { color: '#666', textAlign: 'center', padding: 40, fontSize: 16 },
  countLabel: { fontSize: 13, color: '#555', textAlign: 'left', marginTop: 12 },
});

const md = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#181818' },
  header: {
    flexDirection: 'row', padding: 20, paddingBottom: 16,
    borderBottomWidth: 0.5, borderBottomColor: '#333', alignItems: 'flex-start',
  },
  title:    { fontSize: 20, fontWeight: '700', color: '#fff' },
  sub:      { fontSize: 14, color: '#888', marginTop: 2 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#2a2a2a', alignItems: 'center', justifyContent: 'center', marginLeft: 12 },
  closeTxt: { color: '#aaa', fontSize: 16 },
  body:     { padding: 20, gap: 14 },
  row:      { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: '#2a2a2a' },
  rowLabel: { fontSize: 14, color: '#888', flex: 1 },
  rowValue: { fontSize: 14, color: '#fff', fontWeight: '500', flex: 2, textAlign: 'right' },
  formBtn: {
    marginTop: 8, backgroundColor: '#2a2a2a', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center', borderWidth: 0.5, borderColor: '#555',
  },
  formBtnTxt: { color: '#ccc', fontSize: 15, fontWeight: '600' },
  approveFullBtn: {
    marginTop: 12, backgroundColor: '#1D9E75', borderRadius: 12,
    paddingVertical: 16, alignItems: 'center',
  },
  approveFullBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
