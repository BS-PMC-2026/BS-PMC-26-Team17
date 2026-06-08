import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import NearbyShelterSheet, { type SheetShelter } from '@/components/NearbyShelterSheet';

// User sits in central Tel Aviv. Distances below are roughly:
//   nearby     (32.080, 34.781) → ~150m
//   medium     (32.090, 34.781) → ~1.1km
//   far        (32.20,  34.78)  → ~13km
//   farthest   (32.50,  34.78)  → ~47km
const USER = { latitude: 32.080, longitude: 34.780 };

const mk = (overrides: Partial<SheetShelter>): SheetShelter => ({
  id: overrides.id || 'x',
  name: 'Shelter',
  latitude: 32.080,
  longitude: 34.781,
  accessStatus: 'open',
  capacity: 100,   // ensure available spots > 5 so capacity filter passes
  ...overrides,
});

describe('NearbyShelterSheet', () => {
  it('renders nothing useful when userLocation is null (waiting for GPS)', () => {
    const { getByText, queryByTestId } = render(
      <NearbyShelterSheet
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
    // All within 10-min walking range (~830m max at 83mpm):
    //   nearby  (32.080, 34.781) → ~90m   (~1 min)
    //   medium  (32.083, 34.781) → ~345m  (~4 min)
    //   far     (32.086, 34.781) → ~672m  (~8 min)
    const { getAllByTestId } = render(
      <NearbyShelterSheet
        visible
        onClose={jest.fn()}
        onPick={jest.fn()}
        shelters={[
          mk({ id: 'far',    latitude: 32.086, longitude: 34.781 }),
          mk({ id: 'nearby', latitude: 32.080, longitude: 34.781 }),
          mk({ id: 'medium', latitude: 32.083, longitude: 34.781 }),
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
        visible
        onClose={jest.fn()}
        onPick={jest.fn()}
        shelters={[
          mk({ id: 'open',     accessStatus: 'open' }),
          mk({ id: 'closed',   accessStatus: 'closed' }),
          mk({ id: 'locked',   accessStatus: 'locked' }),
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
    const many = Array.from({ length: 25 }, (_, i) =>
      mk({ id: `s${i}`, latitude: 32.080 + i * 0.001, longitude: 34.781 }),
    );
    const { getAllByTestId } = render(
      <NearbyShelterSheet
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
        visible
        onClose={jest.fn()}
        onPick={jest.fn()}
        shelters={[mk({ id: 'a', capacity: 100, reservedPlaces: 7, actualOccupancy: 3 })]}
        userLocation={USER}
      />,
    );
    expect(getByText('10/100')).toBeTruthy();
  });

  it('calls onPick with the chosen shelter and the current group size', () => {
    const onPick = jest.fn();
    const target = mk({ id: 'pick-me' });
    const { getByTestId } = render(
      <NearbyShelterSheet
        visible
        onClose={jest.fn()}
        onPick={onPick}
        shelters={[target]}
        userLocation={USER}
      />,
    );
    fireEvent.press(getByTestId('nearby-sheet-row-pick-me'));
    expect(onPick).toHaveBeenCalledTimes(1);
    // Default group size is 1; the second arg ensures the stepper value
    // travels with the pick so the parent can post a reservation.
    expect(onPick).toHaveBeenCalledWith(target, 1);
  });

  it('passes the current stepper value through to onPick', () => {
    const onPick = jest.fn();
    const target = mk({ id: 'pick-me' });
    const { getByTestId } = render(
      <NearbyShelterSheet
        visible
        onClose={jest.fn()}
        onPick={onPick}
        shelters={[target]}
        userLocation={USER}
      />,
    );
    // Tap + a few times to bump the stepper to 4
    fireEvent.press(getByTestId('nearby-sheet-group-size-inc'));
    fireEvent.press(getByTestId('nearby-sheet-group-size-inc'));
    fireEvent.press(getByTestId('nearby-sheet-group-size-inc'));
    fireEvent.press(getByTestId('nearby-sheet-row-pick-me'));
    expect(onPick).toHaveBeenLastCalledWith(target, 4);
  });

  it('calls onClose when the cancel button is tapped', () => {
    const onClose = jest.fn();
    const { getByTestId } = render(
      <NearbyShelterSheet
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
});
