import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import SirenModeSheet from '@/components/SirenModeSheet';

describe('SirenModeSheet', () => {
  it('renders all three transport-mode buttons', () => {
    const { getByTestId } = render(
      <SirenModeSheet
        visible
        onClose={jest.fn()}
        onPick={jest.fn()}
        currentMode="walking"
      />,
    );
    expect(getByTestId('siren-mode-walking')).toBeTruthy();
    expect(getByTestId('siren-mode-cycling')).toBeTruthy();
    expect(getByTestId('siren-mode-driving')).toBeTruthy();
  });

  it.each(['walking', 'cycling', 'driving'] as const)(
    'calls onPick("%s") when that mode is tapped',
    (mode) => {
      const onPick = jest.fn();
      const { getByTestId } = render(
        <SirenModeSheet
          visible
          onClose={jest.fn()}
          onPick={onPick}
          currentMode="walking"
        />,
      );
      fireEvent.press(getByTestId(`siren-mode-${mode}`));
      expect(onPick).toHaveBeenCalledTimes(1);
      expect(onPick).toHaveBeenCalledWith(mode);
    },
  );

  it('calls onClose when cancel is tapped', () => {
    const onClose = jest.fn();
    const { getByTestId } = render(
      <SirenModeSheet
        visible
        onClose={onClose}
        onPick={jest.fn()}
        currentMode="walking"
      />,
    );
    fireEvent.press(getByTestId('siren-sheet-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the backdrop is tapped', () => {
    const onClose = jest.fn();
    const { getByTestId } = render(
      <SirenModeSheet
        visible
        onClose={onClose}
        onPick={jest.fn()}
        currentMode="walking"
      />,
    );
    fireEvent.press(getByTestId('siren-sheet-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
