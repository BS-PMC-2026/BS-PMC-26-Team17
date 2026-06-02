import React, { useMemo, useState, useEffect } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView, Pressable,
} from 'react-native';
import { NavigationService, type Coord } from '@/services/NavigationService';
import GroupSizeStepper from '@/components/GroupSizeStepper';

/**
 * Pre-alarm action sheet — shown when the user taps the "התרעה מוקדמת"
 * (early-warning) banner. Lists the 10 closest *open* shelters so the user
 * can pre-emptively head to one before an actual siren fires.
 *
 * Filtering rules (match the map's "usable shelter" definition):
 *   - excluded: accessStatus = 'closed' | 'locked'
 *   - excluded: shouldBeOpen === false
 *   - kept: isFull === true  (a full shelter is still better than no shelter)
 *
 * On pick, the parent is told which shelter — it handles the actual
 * router.push so the sim-joystick `fromLat/fromLng` chaining stays in one
 * place (map.tsx) rather than duplicated here.
 */

export type SheetShelter = {
  id: string;
  latitude: number;
  longitude: number;
  name: string;
  address?: string;
  accessStatus?: string;
  shouldBeOpen?: boolean;
  isFull?: boolean;
  capacity?: number;
  reservedPlaces?: number;
  actualOccupancy?: number;
  isAccessible?: boolean;
  petIssueReported?: boolean;
  demographicPotential?: number;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  /**
   * Fires when the user picks a shelter from the list. The group size is
   * captured by the stepper at the top of the sheet so the parent can
   * post the reservation in one call.
   */
  onPick: (s: SheetShelter, groupSize: number) => void;
  shelters: SheetShelter[];
  /** User's current position — needed to sort by distance. Null = no GPS yet. */
  userLocation: Coord | null;
  /** Max rows to show. Default 10. */
  limit?: number;
  /** Initial value for the group-size stepper. Default 1. */
  initialGroupSize?: number;
  /** Number of children in the group — slows walking speed. */
  childrenCount?: number;
  /** Whether the user requires an accessible shelter. */
  isAccessible?: boolean;
  /** Whether the user has pets — filters out shelters with pet issues. */
  hasPets?: boolean;
  /** Transport mode: 'driving' | 'cycling' | 'foot'. Default 'foot'. */
  mobilityType?: string;
  /** Called when no shelters pass all filters — parent can show alternatives. */
  onNoShelters?: () => void;
};

function isUsable(
  s: SheetShelter,
  needsAccessible: boolean,
  hasPets: boolean,
): boolean {
  if (s.accessStatus === 'closed' || s.accessStatus === 'locked') return false;
  if (s.shouldBeOpen === false) return false;
  if (needsAccessible && !s.isAccessible) return false;
  if (hasPets && s.petIssueReported !== false) return false;
  const available = (s.capacity ?? 0) - (s.reservedPlaces ?? 0) - (s.actualOccupancy ?? 0);
  if (available <= 5) return false;
  return true;
}

const BASE_SPEED_MPM = 83; // metres per minute — average walking pace
const MAX_ETA_MINUTES = 10;

export default function NearbyShelterSheet({
  visible, onClose, onPick, shelters, userLocation, limit = 10, initialGroupSize = 1,
  childrenCount = 0, isAccessible = false, hasPets = false, mobilityType = 'foot',
  onNoShelters,
}: Props) {
  // Local stepper state — reset to `initialGroupSize` every time the sheet
  // opens so a user opening it twice doesn't see a stale count.
  const [groupSize, setGroupSize] = useState(initialGroupSize);
  useEffect(() => {
    if (visible) setGroupSize(initialGroupSize);
  }, [visible, initialGroupSize]);

  const speedMultiplier = useMemo(() => {
    if (mobilityType === 'driving') return 8;
    if (mobilityType === 'cycling') return 2.5;
    if (isAccessible) return 0.6;
    if (childrenCount > 0) return 0.7;
    return 1;
  }, [mobilityType, isAccessible, childrenCount]);

  console.log('[NearbyShelterSheet]', { speedMultiplier, childrenCount, isAccessible, hasPets, mobilityType });

  const sorted = useMemo(() => {
    if (!userLocation) return [];

    // Step 1: basic usability + accessibility + pet + capacity filters
    const usable = shelters.filter(s => isUsable(s, isAccessible, hasPets));
    console.log('[NearbyShelterSheet sorted] total:', shelters.length, '→ after isUsable:', usable.length);

    // Step 2: ETA filter — only shelters reachable within MAX_ETA_MINUTES
    const withEta = usable.map(s => ({
      s,
      distM: NavigationService.haversineM(userLocation, { latitude: s.latitude, longitude: s.longitude }),
    })).filter(({ distM }) => distM / (BASE_SPEED_MPM * speedMultiplier) <= MAX_ETA_MINUTES);
    console.log('[NearbyShelterSheet sorted] → after ETA filter:', withEta.length);

    // Step 3: demographic balancing — group by address, compute per-shelter quota
    const byAddress = new Map<string, SheetShelter[]>();
    withEta.forEach(({ s }) => {
      const key = s.address || 'unknown';
      if (!byAddress.has(key)) byAddress.set(key, []);
      byAddress.get(key)!.push(s);
    });

    const demoFiltered = withEta.filter(({ s }) => {
      const streetGroup = byAddress.get(s.address || 'unknown') ?? [];
      const totalCap = streetGroup.reduce((sum, x) => sum + (x.capacity ?? 0), 0);
      if (totalCap === 0 || !s.demographicPotential) return true;
      const quota = ((s.capacity ?? 0) / totalCap) * s.demographicPotential;
      return (s.reservedPlaces ?? 0) < quota * 0.9;
    });
    console.log('[NearbyShelterSheet sorted] → after demographic balancing:', demoFiltered.length);

    return demoFiltered
      .sort((a, b) => a.distM - b.distM)
      .slice(0, limit);
  }, [shelters, userLocation, limit, isAccessible, hasPets, speedMultiplier]);

  useEffect(() => {
    console.log('[NearbyShelterSheet] onNoShelters check:', sorted.length, visible, userLocation !== null);
    if (visible && userLocation && sorted.length === 0) {
      console.log('[NearbyShelterSheet] onNoShelters triggered', { sortedLength: sorted.length, isVisible: visible, userLocation });
      onNoShelters?.();
    }
  }, [visible, sorted.length, userLocation]);

  console.log('[NearbyShelterSheet] rendering:', sorted.length, 'shelters, first:', sorted[0]?.s ?? null);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      {/* Tapping the backdrop closes; the sheet itself swallows taps. */}
      <Pressable style={s.backdrop} onPress={onClose} testID="nearby-sheet-backdrop">
        <Pressable style={s.sheet} onPress={() => { /* swallow */ }}>
          <View style={s.handle} />
          <Text style={s.title}>מקלטים בקרבת מקום</Text>
          <Text style={s.sub}>בחר/י מקלט שאליו תרצה/י להגיע</Text>

          <View style={s.stepperWrap}>
            <GroupSizeStepper
              value={groupSize}
              onChange={setGroupSize}
              testIDPrefix="nearby-sheet-group-size"
            />
          </View>

          {!userLocation && (
            <Text style={s.empty}>ממתין למיקום…</Text>
          )}
          {userLocation && sorted.length === 0 && (
            <Text style={s.empty}>לא נמצאו מקלטים פתוחים בקרבת מקום</Text>
          )}

          <ScrollView style={s.list} testID="nearby-sheet-list">
            {sorted.map(({ s: sh, distM }) => {
              const dist = NavigationService.formatDistance(distM);
              const cap = typeof sh.capacity === 'number' ? sh.capacity : null;
              const occ = (sh.reservedPlaces ?? 0) + (sh.actualOccupancy ?? 0);
              const occLabel = cap && cap > 0 ? `${occ}/${cap}` : null;
              return (
                <TouchableOpacity
                  key={sh.id}
                  style={s.row}
                  onPress={() => onPick(sh, groupSize)}
                  testID={`nearby-sheet-row-${sh.id}`}
                >
                  <View style={s.rowMain}>
                    <Text style={s.rowName} numberOfLines={1}>{sh.name || 'מקלט'}</Text>
                    {sh.address ? (
                      <Text style={s.rowAddr} numberOfLines={1}>{sh.address}</Text>
                    ) : null}
                  </View>
                  <View style={s.rowMeta}>
                    <Text style={s.rowDist}>{dist}</Text>
                    {occLabel ? <Text style={s.rowOcc}>{occLabel}</Text> : null}
                    {sh.isFull ? <Text style={s.rowFull}>מלא</Text> : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <TouchableOpacity style={s.cancel} onPress={onClose} testID="nearby-sheet-cancel">
            <Text style={s.cancelText}>ביטול</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 28,
    maxHeight: '80%',
  },
  handle: {
    alignSelf: 'center',
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#ddd',
    marginBottom: 12,
  },
  title:   { fontSize: 18, fontWeight: '800', color: '#222', textAlign: 'right' },
  sub:     { fontSize: 13, color: '#666', marginTop: 4, marginBottom: 14, textAlign: 'right' },
  stepperWrap: { marginBottom: 12 },
  empty:   { textAlign: 'center', color: '#888', paddingVertical: 24, fontSize: 14 },

  list: { maxHeight: 420 },

  row: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  rowMain: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '600', color: '#222', textAlign: 'right' },
  rowAddr: { fontSize: 12, color: '#777', marginTop: 2, textAlign: 'right' },
  rowMeta: { alignItems: 'flex-start', marginLeft: 12, minWidth: 64 },
  rowDist: { fontSize: 13, fontWeight: '700', color: '#1a73e8' },
  rowOcc:  { fontSize: 11, color: '#888', marginTop: 2 },
  rowFull: { fontSize: 11, color: '#E24B4A', fontWeight: '700', marginTop: 2 },

  cancel: { paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  cancelText: { color: '#888', fontSize: 15, fontWeight: '600' },
});
