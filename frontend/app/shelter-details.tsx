import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import * as Location from 'expo-location';

import { useAuth } from '@/context/auth';
import { NavigationService } from '@/services/NavigationService';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Screen from '@/components/ui/Screen';
import ScreenHeader from '@/components/ui/ScreenHeader';
import { Palette, Radius, Spacing, Typography } from '@/constants/theme';

const ACCESS_LABELS: Record<string, string> = {
  open: 'Open', closed: 'Closed', locked: 'Locked', unknown: 'Unknown',
};
const ACCESS_COLORS: Record<string, string> = {
  open:    Palette.success,
  closed:  Palette.danger,
  locked:  Palette.textTertiary,
  unknown: Palette.warning,
};
const CLEAN_LABELS:  Record<string, string> = {
  clean: 'Clean', dirty: 'Dirty', unknown: 'Unknown',
};
const TYPE_LABELS:   Record<string, string> = {
  'public shelter': 'Public Shelter', school: 'School', parking: 'Parking', other: 'Other',
};

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
    // Carried through from map.tsx when the SimJoystick is active so the
    // navigation route is computed from the simulated dot, not real GPS.
    fromLat?: string; fromLng?: string;
    // Alert context — passed when opened during an early-warning alert.
    alertKind?: string;
  }>();

  const lat = parseFloat(p.lat || '0');
  const lng = parseFloat(p.lng || '0');

  const isFull           = p.isFull === 'true';
  const isAccessible     = p.isAccessible === 'true';
  const hasStairs        = p.hasStairs === 'true';
  const petIssueReported = p.petIssueReported === 'true';
  const shouldBeOpen     = p.shouldBeOpen === 'true';
  const isEarlyWarning   = p.alertKind === 'early';

  const [selectedMode, setSelectedMode] = useState<'foot' | 'cycling' | 'driving'>('foot');
  const [distanceM, setDistanceM]       = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      let userLat: number | null = null;
      let userLng: number | null = null;
      if (p.fromLat && p.fromLng) {
        userLat = parseFloat(p.fromLat);
        userLng = parseFloat(p.fromLng);
      } else {
        const pos = await Location.getLastKnownPositionAsync();
        if (pos) { userLat = pos.coords.latitude; userLng = pos.coords.longitude; }
      }
      if (userLat != null && userLng != null) {
        setDistanceM(NavigationService.haversineM(
          { latitude: userLat, longitude: userLng },
          { latitude: lat,     longitude: lng },
        ));
      }
    })();
  }, []);

  const BASE_MPM = 83;
  const SPEED: Record<string, number> = { foot: BASE_MPM, cycling: BASE_MPM * 2.5, driving: BASE_MPM * 8 };
  const etaMin = (mode: string) =>
    distanceM != null ? distanceM / SPEED[mode] : null;
  const tooFar = (mode: string) => { const e = etaMin(mode); return e != null && e > 10; };

  const MODES = [
    { key: 'foot'    as const, label: 'Walking', icon: '🚶' },
    { key: 'cycling' as const, label: 'Cycling', icon: '🚴' },
    { key: 'driving' as const, label: 'Driving', icon: '🚗' },
  ];

  // Status chips at the top of the page. Each one is a self-labelled badge so
  // there's never a bare emoji the user has to guess at. Built from the
  // shelter's flags rather than hand-typed at the call site so future
  // additions (e.g. "Has water") follow the same pattern.
  const statusChips: { icon: string; label: string; tone: 'success' | 'danger' | 'warning' | 'neutral' }[] = [];

  // Access status — Open / Closed / Locked / Unknown
  const access = p.accessStatus || 'unknown';
  const accessTone: 'success' | 'danger' | 'warning' | 'neutral' =
    access === 'open' ? 'success'
    : access === 'closed' ? 'danger'
    : access === 'locked' ? 'neutral'
    : 'warning';
  statusChips.push({
    icon: access === 'open' ? '🟢' : access === 'closed' ? '🔴' : access === 'locked' ? '🔒' : '❓',
    label: ACCESS_LABELS[access],
    tone: accessTone,
  });

  // Capacity — Available / Full
  statusChips.push({
    icon: isFull ? '🚫' : '👥',
    label: isFull ? 'Full' : 'Available',
    tone: isFull ? 'danger' : 'success',
  });

  // Step-free access
  if (isAccessible && !hasStairs) {
    statusChips.push({ icon: '♿', label: 'Step-free', tone: 'success' });
  }

  // Pets allowed
  if (!petIssueReported) {
    statusChips.push({ icon: '🐾', label: 'Pets allowed', tone: 'success' });
  }

  const navigate = () => {
    // Forward the sim "from" point if it was carried in by map.tsx — keeps
    // the simulated joystick position as the start of the route.
    const fromSuffix =
      p.fromLat && p.fromLng ? `&fromLat=${p.fromLat}&fromLng=${p.fromLng}` : '';
    router.push(
      `/navigate?lat=${lat}&lng=${lng}&name=${encodeURIComponent(p.name || 'Shelter')}&mode=${selectedMode}${fromSuffix}`,
    );
  };

  const report = () => {
    router.push(
      `/report?shelterId=${p.id || ''}&shelterName=${encodeURIComponent(p.name || 'Shelter')}` as any,
    );
  };

  const update = () => {
    router.push(`/ShelterDashboard?search=${encodeURIComponent(p.name || '')}`);
  };

  return (
    <Screen variant="light">
      <ScreenHeader title="Shelter Details" />

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        <Text style={s.title} numberOfLines={3}>{p.name || 'Shelter'}</Text>

        {/* Status chips. Each chip pairs an emoji with a short label so the
            meaning is self-evident — no more bare ♿ / 🐾 the user has to guess. */}
        <Text style={s.sectionLabel}>Status</Text>
        <View style={s.chipsRow}>
          {statusChips.map(c => (
            <StatusChip key={c.label} icon={c.icon} label={c.label} tone={c.tone} />
          ))}
        </View>

        <Card>
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
          {p.lastReportType ? <Row label="Report Type" value={p.lastReportType} last /> : null}
        </Card>

        <View style={{ height: Spacing.lg }} />
      </ScrollView>

      {isEarlyWarning && (
        <View style={s.modeRow}>
          {MODES.map(m => {
            const far  = tooFar(m.key);
            const eta  = etaMin(m.key);
            const etaLabel = eta != null ? `${Math.ceil(eta)} min` : '';
            const active   = selectedMode === m.key;
            return (
              <TouchableOpacity
                key={m.key}
                style={[s.modeBtn, active && s.modeBtnOn, far && s.modeBtnFar]}
                onPress={() => !far && setSelectedMode(m.key)}
                disabled={far}
                activeOpacity={0.85}
              >
                <Text style={s.modeBtnIcon}>{m.icon}</Text>
                <Text style={[s.modeBtnLabel, active && s.modeBtnLabelOn]}>{m.label}</Text>
                {etaLabel ? <Text style={[s.modeBtnEta, far && s.modeBtnEtaFar]}>{etaLabel}</Text> : null}
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <View style={s.actions}>
        <Button
          label="Navigate"
          icon="🧭"
          variant="primary"
          onPress={navigate}
          disabled={isEarlyWarning && tooFar(selectedMode)}
          style={s.actionBtn}
        />
        <Button
          label="Report"
          icon="⚠️"
          variant="danger"
          onPress={report}
          style={s.actionBtn}
        />
        {isAdmin && (
          <Button
            label="Update"
            icon="✏️"
            variant="secondary"
            onPress={update}
            style={s.actionBtn}
          />
        )}
      </View>
    </Screen>
  );
}

function Row({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[s.dataRow, last && s.dataRowLast]}>
      <Text style={s.dataLabel}>{label}</Text>
      <Text style={s.dataValue} numberOfLines={3}>{value}</Text>
    </View>
  );
}

function StatusChip({
  icon, label, tone,
}: {
  icon: string;
  label: string;
  tone: 'success' | 'danger' | 'warning' | 'neutral';
}) {
  const toneStyle = {
    success: { bg: Palette.successSoft, fg: Palette.success },
    danger:  { bg: Palette.dangerSoft,  fg: Palette.danger  },
    warning: { bg: Palette.warningSoft, fg: Palette.warning },
    neutral: { bg: Palette.bgSubtle,    fg: Palette.textSecondary },
  }[tone];
  return (
    <View style={[s.chip, { backgroundColor: toneStyle.bg, borderColor: toneStyle.fg }]}>
      <Text style={s.chipIcon}>{icon}</Text>
      <Text style={[s.chipText, { color: toneStyle.fg }]}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  scroll:        { flex: 1 },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop:        Spacing.sm,
    paddingBottom:     Spacing.xl,
  },

  title: {
    ...Typography.title,
    color: Palette.textPrimary,
    marginBottom: Spacing.md,
  },

  sectionLabel: {
    ...Typography.sectionLabel,
    color: Palette.textTertiary,
    marginBottom: Spacing.sm,
  },

  chipsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    flexWrap: 'wrap',
    marginBottom: Spacing.lg,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
    borderWidth: 1,
    gap: Spacing.xs,
  },
  chipIcon: { fontSize: 14 },
  chipText: {
    ...Typography.bodyStrong,
    fontSize: 13,
  },

  dataRow: {
    flexDirection: 'row',
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Palette.borderSubtle,
  },
  dataRowLast: { borderBottomWidth: 0 },
  dataLabel: {
    width: 140,
    ...Typography.caption,
    color: Palette.textSecondary,
    fontWeight: '600',
  },
  dataValue: {
    flex: 1,
    ...Typography.body,
    color: Palette.textPrimary,
  },

  // Transport mode picker — only shown during an early warning.
  modeRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Palette.borderSubtle,
  },
  modeBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Palette.borderSubtle,
    backgroundColor: Palette.bgSubtle,
  },
  modeBtnOn:      { borderColor: Palette.brand, backgroundColor: Palette.brandSoft },
  modeBtnFar:     { opacity: 0.4 },
  modeBtnIcon:    { fontSize: 20, marginBottom: 2 },
  modeBtnLabel:   { ...Typography.small, color: Palette.textSecondary, fontWeight: '600' },
  modeBtnLabelOn: { color: Palette.brand },
  modeBtnEta:     { ...Typography.small, color: Palette.textTertiary, marginTop: 2 },
  modeBtnEtaFar:  { color: Palette.danger },

  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    padding: Spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Palette.borderSubtle,
    backgroundColor: Palette.bg,
  },
  actionBtn: { flex: 1 },
});
