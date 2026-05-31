import React, { useMemo, useEffect, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView, Pressable,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationService, type Coord } from '@/services/NavigationService';

/**
 * Pre-alarm action sheet — shown when the user taps the "התרעה מוקדמת"
 * (early-warning) banner. Lists the 10 closest *open* shelters so the user
 * can pre-emptively head to one before an actual siren fires.
 *
 * Filtering rules:
 *   - excluded: accessStatus = 'closed' | 'locked'
 *   - excluded: shouldBeOpen === false
 *   - excluded: distance exceeds 10-minute reachable range (speed adjusted for
 *               mobility impairment and children)
 *   - excluded: petIssueReported === true when user has pets
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
  petIssueReported?: boolean;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onPick: (s: SheetShelter) => void;
  shelters: SheetShelter[];
  /** User's current position — needed to sort by distance. Null = no GPS yet. */
  userLocation: Coord | null;
  /** Max rows to show. Default 10. */
  limit?: number;
  childrenCount: number;
  isAccessible: boolean;
  hasPets: boolean;
};

// 5 km/h = 83.3 m/min
const BASE_SPEED_MPM = 83.3;
const MAX_MINUTES    = 10;

function calcMaxDistM(isHandicapped: boolean, childrenCount: number): number {
  let speed = BASE_SPEED_MPM;
  if (isHandicapped)    speed *= 0.6;
  if (childrenCount > 0) speed *= 0.7;
  return speed * MAX_MINUTES;
}

export default function NearbyShelterSheet({
  visible, onClose, onPick, shelters, userLocation, limit = 10,
  childrenCount, isAccessible, hasPets,
}: Props) {
  // Load isHandicapped (and confirm childrenCount/hasPets) from persisted settings.
  const [isHandicapped,       setIsHandicapped]       = useState(false);
  const [settingsChildrenCount, setSettingsChildrenCount] = useState(childrenCount);
  const [settingsHasPets,     setSettingsHasPets]     = useState(hasPets);

  useEffect(() => {
    AsyncStorage.getItem('userSettings').then(raw => {
      if (!raw) return;
      try {
        const p = JSON.parse(raw);
        setIsHandicapped(!!p.isHandicapped);
        setSettingsChildrenCount(
          typeof p.childrenCount === 'number' ? p.childrenCount : childrenCount,
        );
        setSettingsHasPets(typeof p.hasPets === 'boolean' ? p.hasPets : hasPets);
      } catch {}
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sorted = useMemo(() => {
    if (!userLocation) return [];
    const maxDistM = calcMaxDistM(isHandicapped, settingsChildrenCount);

    return shelters
      .map(sh => ({
        s: sh,
        distM: NavigationService.haversineM(userLocation, {
          latitude: sh.latitude, longitude: sh.longitude,
        }),
      }))
      .filter(({ s: sh, distM }) => {
        if (sh.accessStatus === 'closed' || sh.accessStatus === 'locked') return false;
        if (sh.shouldBeOpen === false) return false;
        if (distM > maxDistM) return false;
        if (settingsHasPets && sh.petIssueReported === true) return false;
        return true;
      })
      .sort((a, b) => a.distM - b.distM)
      .slice(0, limit);
  }, [shelters, userLocation, limit, isHandicapped, settingsChildrenCount, settingsHasPets]);

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
                  onPress={() => onPick(sh)}
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
