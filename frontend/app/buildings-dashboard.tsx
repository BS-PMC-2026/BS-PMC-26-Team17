import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Modal,
} from 'react-native';
import { useAuth } from '@/context/auth';
import { WebView } from 'react-native-webview';

import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Screen from '@/components/ui/Screen';
import ScreenHeader from '@/components/ui/ScreenHeader';
import { DarkPalette, Radius, Spacing, Typography } from '@/constants/theme';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

type Building = {
  id: string;
  address: string;
  city: string;
  managerName?: string;
  managerUserId?: string;
  registrationStatus: 'pending' | 'approved' | 'rejected' | 'cancelled';
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
  pending:   DarkPalette.warning,
  approved:  DarkPalette.success,
  rejected:  DarkPalette.danger,
  cancelled: DarkPalette.danger,
};
const STATUS_LABELS: Record<string, string> = {
  pending:   'Pending',
  approved:  'Approved',
  rejected:  'Rejected',
  cancelled: 'Rejected',
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

  // `load` is intentionally not in the deps — it changes every render and
  // we only want to re-fetch when admin status flips.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // URL of the document for the in-app viewer. Only real PDFs go through the
  // backend's `/viewer` endpoint (Mozilla PDF.js) — Android WebView can't
  // display PDFs natively, but it renders HTML and images just fine. Routing
  // HTML certificates through PDF.js makes the worker try to parse `<!DOCTYPE`
  // as PDF bytes and the loader hangs forever on Android.
  const viewerUrl = (() => {
    if (!viewing) return '';
    const name = (viewing.registrationFileName || '').toLowerCase();
    const isPdf = /\.pdf$/.test(name);
    const endpoint = isPdf ? 'viewer' : 'file';
    return `${API_URL}/buildings/${viewing.id}/${endpoint}?user_id=${user?.id}`;
  })();

  const filtered = useMemo(() => {
    if (filter === 'All') return buildings;
    if (filter === 'rejected') return buildings.filter(b => b.registrationStatus === 'rejected' || b.registrationStatus === 'cancelled');
    return buildings.filter(b => b.registrationStatus === filter);
  }, [buildings, filter]);

  const totalCount    = buildings.length;
  const pendingCount  = buildings.filter(b => b.registrationStatus === 'pending').length;
  const approvedCount = buildings.filter(b => b.registrationStatus === 'approved').length;
  const rejectedCount = buildings.filter(b => b.registrationStatus === 'rejected' || b.registrationStatus === 'cancelled').length;

  if (!isAdmin) {
    return (
      <Screen variant="dark">
        <View style={s.denied}>
          <Text style={s.deniedText}>Access denied</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen variant="dark">
      <ScreenHeader title="Buildings Dashboard" dark />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Stats */}
        <View style={s.statsRow}>
          {[
            { label: 'Pending',  value: pendingCount,  color: DarkPalette.warning, main: false },
            { label: 'Approved', value: approvedCount, color: DarkPalette.success, main: false },
            { label: 'Rejected', value: rejectedCount, color: DarkPalette.danger,  main: false },
            { label: 'Total',    value: totalCount,    color: DarkPalette.textPrimary, main: true },
          ].map(c => (
            <View key={c.label} style={[s.statCard, c.main && s.statMain]}>
              <Text style={s.statLabel}>{c.label}</Text>
              <Text style={[s.statValue, { color: c.color }]}>{c.value}</Text>
            </View>
          ))}
        </View>

        {/* Filter pills */}
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
                activeOpacity={0.85}
              >
                <Text style={[s.filterBtnTxt, active && s.filterBtnTxtOn]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Table */}
        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={DarkPalette.brand} />
        ) : filtered.length === 0 ? (
          <Text style={s.empty}>No buildings found</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator>
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

                    {/* Actions — icon circles for ✓ / ✕ + a secondary button for the form */}
                    <View style={[s.actionsCell, { width: 240 }]}>
                      {item.registrationStatus === 'pending' && (
                        <>
                          <TouchableOpacity
                            style={s.approveBtn}
                            onPress={() => approve(item)}
                            disabled={approving === item.id || rejecting === item.id}
                            testID={`approve-${item.id}`}
                            activeOpacity={0.85}
                          >
                            {approving === item.id
                              ? <ActivityIndicator size="small" color={DarkPalette.textInverse} />
                              : <Text style={s.approveBtnTxt}>✓</Text>
                            }
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={s.rejectBtn}
                            onPress={() => reject(item)}
                            disabled={rejecting === item.id || approving === item.id}
                            testID={`reject-${item.id}`}
                            activeOpacity={0.85}
                          >
                            {rejecting === item.id
                              ? <ActivityIndicator size="small" color={DarkPalette.textInverse} />
                              : <Text style={s.rejectBtnTxt}>✕</Text>
                            }
                          </TouchableOpacity>
                        </>
                      )}
                      <TouchableOpacity
                        style={s.viewBtn}
                        onPress={() => openForm(item)}
                        testID={`view-form-${item.id}`}
                        activeOpacity={0.85}
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

        <Text style={s.countLabel}>
          Showing {filtered.length} building{filtered.length !== 1 ? 's' : ''}
        </Text>
      </ScrollView>

      {/* Detail Modal */}
      <Modal
        visible={!!selected}
        animationType="slide"
        onRequestClose={() => setSelected(null)}
      >
        <Screen variant="dark">
          <ScreenHeader
            title={selected?.address ?? ''}
            dark
            onBack={() => setSelected(null)}
          />
          <ScrollView contentContainerStyle={md.body}>
            {!!selected?.city && (
              <Text style={md.sub}>
                {selected.city}{selected.neighborhood ? `, ${selected.neighborhood}` : ''}
              </Text>
            )}

            <Card dark>
              {[
                { label: 'Manager',          value: selected?.managerName || selected?.managerUserId },
                { label: 'Status',           value: selected?.registrationStatus },
                { label: 'Entrance Code',    value: selected?.entranceCode },
                { label: 'Apartments',       value: selected?.apartmentCount?.toString() },
                { label: 'Shelter Location', value: selected?.shelterLocation },
                { label: 'Registered At',    value: selected?.createdAt
                    ? new Date(selected.createdAt).toLocaleString() : undefined },
              ].map((row, i, arr) => row.value ? (
                <View
                  key={row.label}
                  style={[md.row, i === arr.length - 1 && md.rowLast]}
                >
                  <Text style={md.rowLabel}>{row.label}</Text>
                  <Text style={md.rowValue}>{row.value}</Text>
                </View>
              ) : null)}
            </Card>

            <Button
              label="View Permit Document"
              icon="📄"
              variant="secondary"
              onPress={() => selected && openForm(selected)}
            />

            {selected?.registrationStatus === 'pending' && (
              <Button
                label="Approve This Building"
                icon="✓"
                variant="success"
                onPress={() => { setSelected(null); selected && approve(selected); }}
                style={{ marginTop: Spacing.md }}
              />
            )}
          </ScrollView>
        </Screen>
      </Modal>

      {/* In-app document viewer (PDFs / images) */}
      <Modal
        visible={!!viewing}
        animationType="slide"
        onRequestClose={() => setViewing(null)}
      >
        <Screen variant="dark">
          <ScreenHeader
            title="Permit Document"
            dark
            onBack={() => setViewing(null)}
          />
          {viewing && (
            <WebView
              source={{ uri: viewerUrl }}
              style={{ flex: 1, backgroundColor: '#fff' }}
              originWhitelist={['*']}
              startInLoadingState
              // Android: allow HTTPS scripts (PDF.js from CDN) inside our
              // HTTP page — otherwise the PDF.js never loads and the user
              // sees a blank or the raw binary download fallback.
              mixedContentMode="always"
              javaScriptEnabled
              domStorageEnabled
              // If the WebView is asked to download a file (Android's default
              // for PDFs it can't render), fall back to the OS handler.
              onShouldStartLoadWithRequest={() => true}
              renderLoading={() => (
                <View style={pdfStyles.loading}>
                  <ActivityIndicator size="large" color={DarkPalette.brand} />
                </View>
              )}
            />
          )}
        </Screen>
      </Modal>
    </Screen>
  );
}

const pdfStyles = StyleSheet.create({
  loading: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff',
  },
});

const s = StyleSheet.create({
  denied: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deniedText: {
    ...Typography.title,
    color: DarkPalette.danger,
  },

  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop:        Spacing.md,
    paddingBottom:     Spacing.xxxl,
  },

  // Stats — four equal cards, "Total" slightly wider so the number reads
  // as the primary metric.
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  statCard: {
    flex: 1,
    minHeight: 96,
    backgroundColor: DarkPalette.card,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.sm,
    paddingTop:    Spacing.sm,
    paddingBottom: Spacing.md,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DarkPalette.borderSubtle,
  },
  statMain:  { flex: 1.3, borderColor: DarkPalette.borderStrong },
  statLabel: {
    ...Typography.small,
    color: DarkPalette.textTertiary,
    textAlign: 'center',
  },
  statValue: { fontSize: 28, fontWeight: '600', lineHeight: 32 },

  // Filter pills
  filterRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  filterBtn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DarkPalette.borderSubtle,
    backgroundColor: DarkPalette.card,
  },
  filterBtnOn: {
    borderColor: DarkPalette.brand,
    backgroundColor: DarkPalette.brandSoft,
  },
  filterBtnTxt: {
    ...Typography.bodyStrong,
    color: DarkPalette.textSecondary,
  },
  filterBtnTxtOn: { color: DarkPalette.textPrimary },

  // Table
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: DarkPalette.card,
    borderTopLeftRadius:  Radius.md,
    borderTopRightRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DarkPalette.borderSubtle,
    paddingVertical: Spacing.md,
  },
  headerCell: {
    ...Typography.small,
    color: DarkPalette.textTertiary,
    textAlign: 'center',
    paddingHorizontal: Spacing.xs,
    paddingVertical: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DarkPalette.borderSubtle,
    backgroundColor: DarkPalette.bgSubtle,
    alignItems: 'center',
    minHeight: 64,
  },
  rowAlt:  { backgroundColor: DarkPalette.card },
  cell: {
    ...Typography.caption,
    color: DarkPalette.textSecondary,
    paddingHorizontal: Spacing.xs,
    textAlign: 'center',
  },
  cellBold: {
    ...Typography.bodyStrong,
    fontSize: 13,
    color: DarkPalette.textPrimary,
    paddingHorizontal: Spacing.xs,
  },
  cellCenter: { paddingHorizontal: Spacing.xs, alignItems: 'center', justifyContent: 'center' },

  // Compact icon buttons in the actions column (✓ approve, ✕ reject) +
  // a secondary "Form" button that uses the same outline pattern as the
  // shared `Button` secondary variant.
  actionsCell: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.xs, alignItems: 'center' },
  approveBtn: {
    backgroundColor: DarkPalette.success,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    minWidth: 40,
    alignItems: 'center',
  },
  approveBtnTxt: {
    color: DarkPalette.textInverse,
    fontSize: 14,
    fontWeight: '700',
  },
  rejectBtn: {
    backgroundColor: DarkPalette.danger,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    minWidth: 40,
    alignItems: 'center',
  },
  rejectBtnTxt: {
    color: DarkPalette.textInverse,
    fontSize: 14,
    fontWeight: '700',
  },
  viewBtn: {
    backgroundColor: 'transparent',
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: DarkPalette.brand,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
  },
  viewBtnTxt: {
    ...Typography.small,
    color: DarkPalette.brand,
  },

  empty: {
    ...Typography.body,
    color: DarkPalette.textTertiary,
    textAlign: 'center',
    padding: Spacing.xxl,
  },
  countLabel: {
    ...Typography.caption,
    color: DarkPalette.textTertiary,
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.xs,
  },
});

// Detail modal — uses the shared `Card dark` for the info block; only
// row-internal styles live here so the modal body stays compact.
const md = StyleSheet.create({
  body: {
    paddingHorizontal: Spacing.lg,
    paddingTop:        Spacing.md,
    paddingBottom:     Spacing.xxxl,
    gap:               Spacing.md,
  },
  sub: {
    ...Typography.body,
    color: DarkPalette.textSecondary,
    textAlign: 'center',
    marginTop: -Spacing.xs,
    marginBottom: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DarkPalette.borderSubtle,
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: {
    ...Typography.body,
    color: DarkPalette.textTertiary,
    flex: 1,
  },
  rowValue: {
    ...Typography.bodyStrong,
    color: DarkPalette.textPrimary,
    flex: 2,
    textAlign: 'right',
  },
});
