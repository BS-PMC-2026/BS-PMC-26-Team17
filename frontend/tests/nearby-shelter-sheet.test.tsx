import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import NearbyShelterSheet, { type SheetShelter } from '@/components/NearbyShelterSheet';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(null),
}));

// User sits at a fixed point. Distances below are roughly due north of user:
//   nearby   (32.080, 34.781) →  ~80 m   (default mk() coords)
//   medium   (32.084, 34.781) → ~450 m   (within 833 m base range)
//   far      (32.087, 34.781) → ~780 m   (within 833 m base range, beyond 583 m children range)
//   too-far  (32.089, 34.780) → ~900 m   (beyond 833 m base range)
//
// Speed table (83.3 m/min base × 10 min):
//   no modifiers           → 833 m
//   childrenCount > 0      → 83.3 × 0.7 × 10 = 583 m
//   isHandicapped          → 83.3 × 0.6 × 10 = 500 m
//   both                   → 83.3 × 0.6 × 0.7 × 10 = 350 m
const USER = { latitude: 32.080, longitude: 34.780 };

// Spread onto every render so new required props are always present.
const DEFAULT_PROPS = {
  childrenCount: 0,
  isAccessible: false,
  hasPets: false,
};

const mk = (overrides: Partial<SheetShelter>): SheetShelter => ({
  id: overrides.id || 'x',
  name: 'Shelter',
  latitude: 32.080,
  longitude: 34.781,
  accessStatus: 'open',
  ...overrides,
});

describe('NearbyShelterSheet', () => {
  it('renders nothing useful when userLocation is null (waiting for GPS)', () => {
    const { getByText, queryByTestId } = render(
      <NearbyShelterSheet
        {...DEFAULT_PROPS}
        visible
        onClose={jest.fn()}
        onPick={jest.fn()}
        shelters={[mk({ id: 'a' })]}
        userLocation={null}
      />,
    );
    expect(getByText(/ממתין למיקום/)).toBeTruthy();
    expect(queryByTestId('nearby-sheet-row-a')).toBeNull();
  });

  it('shows empty-state message when all shelters are filtered out', () => {
    const { getByText } = render(
      <NearbyShelterSheet
        {...DEFAULT_PROPS}
        visible
        onClose={jest.fn()}
        onPick={jest.fn()}
        shelters={[
          mk({ id: 'a', accessStatus: 'closed' }),
          mk({ id: 'b', accessStatus: 'locked' }),
          mk({ id: 'c', shouldBeOpen: false }),
        ]}
        userLocation={USER}
      />,
    );
    expect(getByText(/לא נמצאו מקלטים פתוחים/)).toBeTruthy();
  });

  it('sorts shelters by distance ascending', () => {
    const { getAllByTestId } = render(
      <NearbyShelterSheet
        {...DEFAULT_PROPS}
        visible
        onClose={jest.fn()}
        onPick={jest.fn()}
        shelters={[
          mk({ id: 'far',    latitude: 32.087, longitude: 34.781 }), // ~780 m
          mk({ id: 'nearby', latitude: 32.080, longitude: 34.781 }), //  ~80 m
          mk({ id: 'medium', latitude: 32.084, longitude: 34.781 }), // ~450 m
        ]}
        userLocation={USER}
      />,
    );
    const rows = getAllByTestId(/^nearby-sheet-row-/);
    const ids = rows.map(r => r.props.testID.replace('nearby-sheet-row-', ''));
    expect(ids).toEqual(['nearby', 'medium', 'far']);
  });

  it('filters out closed, locked, and shouldBeOpen=false shelters', () => {
    const { queryByTestId, getByTestId } = render(
      <NearbyShelterSheet
        {...DEFAULT_PROPS}
        visible
        onClose={jest.fn()}
        onPick={jest.fn()}
        shelters={[
          mk({ id: 'open',       accessStatus: 'open' }),
          mk({ id: 'closed',     accessStatus: 'closed' }),
          mk({ id: 'locked',     accessStatus: 'locked' }),
          mk({ id: 'closed-flag', shouldBeOpen: false }),
        ]}
        userLocation={USER}
      />,
    );
    expect(getByTestId('nearby-sheet-row-open')).toBeTruthy();
    expect(queryByTestId('nearby-sheet-row-closed')).toBeNull();
    expect(queryByTestId('nearby-sheet-row-locked')).toBeNull();
    expect(queryByTestId('nearby-sheet-row-closed-flag')).toBeNull();
  });

  it('keeps full shelters (full is still better than no shelter)', () => {
    const { getByTestId, getByText } = render(
      <NearbyShelterSheet
        {...DEFAULT_PROPS}
        visible
        onClose={jest.fn()}
        onPick={jest.fn()}
        shelters={[mk({ id: 'full-one', isFull: true })]}
        userLocation={USER}
      />,
    );
    expect(getByTestId('nearby-sheet-row-full-one')).toBeTruthy();
    expect(getByText('מלא')).toBeTruthy();
  });

  it('respects the `limit` prop', () => {
    // 25 shelters spaced 0.001° apart; the first 8 (s0–s7) fall within 833 m,
    // which is more than limit=5, so exactly 5 rows should appear.
    const many = Array.from({ length: 25 }, (_, i) =>
      mk({ id: `s${i}`, latitude: 32.080 + i * 0.001, longitude: 34.781 }),
    );
    const { getAllByTestId } = render(
      <NearbyShelterSheet
        {...DEFAULT_PROPS}
        visible
        onClose={jest.fn()}
        onPick={jest.fn()}
        shelters={many}
        userLocation={USER}
        limit={5}
      />,
    );
    expect(getAllByTestId(/^nearby-sheet-row-/)).toHaveLength(5);
  });

  it('shows reservedPlaces + actualOccupancy / capacity', () => {
    const { getByText } = render(
      <NearbyShelterSheet
        {...DEFAULT_PROPS}
        visible
        onClose={jest.fn()}
        onPick={jest.fn()}
        shelters={[mk({ id: 'a', capacity: 100, reservedPlaces: 7, actualOccupancy: 3 })]}
        userLocation={USER}
      />,
    );
    expect(getByText('10/100')).toBeTruthy();
  });

  it('calls onPick with the chosen shelter when a row is tapped', () => {
    const onPick = jest.fn();
    const target = mk({ id: 'pick-me' });
    const { getByTestId } = render(
      <NearbyShelterSheet
        {...DEFAULT_PROPS}
        visible
        onClose={jest.fn()}
        onPick={onPick}
        shelters={[target]}
        userLocation={USER}
      />,
    );
    fireEvent.press(getByTestId('nearby-sheet-row-pick-me'));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(target);
  });

  it('calls onClose when the cancel button is tapped', () => {
    const onClose = jest.fn();
    const { getByTestId } = render(
      <NearbyShelterSheet
        {...DEFAULT_PROPS}
        visible
        onClose={onClose}
        onPick={jest.fn()}
        shelters={[]}
        userLocation={USER}
      />,
    );
    fireEvent.press(getByTestId('nearby-sheet-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ── Distance filtering ────────────────────────────────────────────────────

  it('filters out shelters beyond 10-minute walking distance (~833 m)', () => {
    const { getByTestId, queryByTestId } = render(
      <NearbyShelterSheet
        {...DEFAULT_PROPS}
        visible
        onClose={jest.fn()}
        onPick={jest.fn()}
        shelters={[
          mk({ id: 'within',  latitude: 32.0845, longitude: 34.780 }), // ~500 m — inside range
          mk({ id: 'outside', latitude: 32.0890, longitude: 34.780 }), // ~900 m — beyond 833 m
        ]}
        userLocation={USER}
      />,
    );
    expect(getByTestId('nearby-sheet-row-within')).toBeTruthy();
    expect(queryByTestId('nearby-sheet-row-outside')).toBeNull();
  });

  it('reduces reachable range to ~583 m when childrenCount > 0', () => {
    // 83.3 m/min × 0.7 (children penalty) × 10 min = 583 m.
    // Shelter at ~450 m: inside both ranges → shown.
    // Shelter at ~780 m: inside base 833 m range but beyond 583 m → filtered.
    const { getByTestId, queryByTestId } = render(
      <NearbyShelterSheet
        {...DEFAULT_PROPS}
        childrenCount={1}
        visible
        onClose={jest.fn()}
        onPick={jest.fn()}
        shelters={[
          mk({ id: 'close',   latitude: 32.084, longitude: 34.781 }), // ~450 m
          mk({ id: 'mid-far', latitude: 32.087, longitude: 34.781 }), // ~780 m
        ]}
        userLocation={USER}
      />,
    );
    expect(getByTestId('nearby-sheet-row-close')).toBeTruthy();
    expect(queryByTestId('nearby-sheet-row-mid-far')).toBeNull();
  });

  // ── Pet filtering ─────────────────────────────────────────────────────────

  it('filters out shelters with petIssueReported=true when hasPets=true', () => {
    const { getByTestId, queryByTestId } = render(
      <NearbyShelterSheet
        {...DEFAULT_PROPS}
        hasPets
        visible
        onClose={jest.fn()}
        onPick={jest.fn()}
        shelters={[
          mk({ id: 'ok',        petIssueReported: false }),
          mk({ id: 'pet-issue', petIssueReported: true }),
        ]}
        userLocation={USER}
      />,
    );
    expect(getByTestId('nearby-sheet-row-ok')).toBeTruthy();
    expect(queryByTestId('nearby-sheet-row-pet-issue')).toBeNull();
  });

  it('shows shelters with petIssueReported=true when hasPets=false', () => {
    const { getByTestId } = render(
      <NearbyShelterSheet
        {...DEFAULT_PROPS}
        hasPets={false}
        visible
        onClose={jest.fn()}
        onPick={jest.fn()}
        shelters={[mk({ id: 'pet-issue', petIssueReported: true })]}
        userLocation={USER}
      />,
    );
    expect(getByTestId('nearby-sheet-row-pet-issue')).toBeTruthy();
  });
});
