import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import AlertBanner from '@/components/AlertBanner';
import type { Alert as PikudAlert } from '@/services/AlertsService';

const mk = (overrides: Partial<PikudAlert> = {}): PikudAlert => ({
  id: 'a1',
  kind: 'early',
  title: 'התרעה',
  areas: ['באר שבע'],
  ...overrides,
});

describe('AlertBanner', () => {
  it('renders nothing visible when alert is null', () => {
    const { queryByTestId } = render(
      <AlertBanner alert={null} onDismiss={jest.fn()} />,
    );
    // The animated wrapper still mounts so slide-up plays — but the row content
    // (and thus the `alert-banner` testID) only renders when an alert exists.
    expect(queryByTestId('alert-banner')).toBeNull();
  });

  it('does NOT show the tap hint when onPress is omitted', () => {
    const { queryByText } = render(
      <AlertBanner alert={mk({ kind: 'early' })} onDismiss={jest.fn()} />,
    );
    expect(queryByText(/הקש לבחירת מקלט/)).toBeNull();
    expect(queryByText(/הקש לשינוי/)).toBeNull();
  });

  it('shows the pre-alarm hint when onPress is wired and kind=early', () => {
    const { getByText } = render(
      <AlertBanner
        alert={mk({ kind: 'early' })}
        onDismiss={jest.fn()}
        onPress={jest.fn()}
      />,
    );
    expect(getByText(/הקש לבחירת מקלט/)).toBeTruthy();
  });

  it('shows the siren hint when onPress is wired and kind=siren', () => {
    const { getByText } = render(
      <AlertBanner
        alert={mk({ kind: 'siren' })}
        onDismiss={jest.fn()}
        onPress={jest.fn()}
      />,
    );
    expect(getByText(/הקש לשינוי אופן הניווט/)).toBeTruthy();
  });

  it('fires onPress when the banner is tapped', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <AlertBanner
        alert={mk()}
        onDismiss={jest.fn()}
        onPress={onPress}
      />,
    );
    fireEvent.press(getByTestId('alert-banner-press'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('close button fires onDismiss without firing onPress', () => {
    const onPress = jest.fn();
    const onDismiss = jest.fn();
    const { getByTestId } = render(
      <AlertBanner
        alert={mk()}
        onDismiss={onDismiss}
        onPress={onPress}
      />,
    );
    fireEvent.press(getByTestId('alert-banner-close'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    // Touchable inside Pressable: tap-to-close shouldn't bubble.
    expect(onPress).not.toHaveBeenCalled();
  });
});
