import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import SirenGroupPromptModal from '@/components/SirenGroupPromptModal';

describe('SirenGroupPromptModal', () => {
  it('renders title, body, stepper, and both buttons when visible', () => {
    const { getByText, getByTestId } = render(
      <SirenGroupPromptModal
        visible
        onConfirm={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );
    expect(getByText(/אזעקה/)).toBeTruthy();
    expect(getByText(/עליך להגיע למקלט/)).toBeTruthy();
    expect(getByTestId('siren-prompt-group-size-stepper')).toBeTruthy();
    expect(getByTestId('siren-prompt-confirm')).toBeTruthy();
    expect(getByTestId('siren-prompt-dismiss')).toBeTruthy();
  });

  it('fires onConfirm with the current group size when אישור is tapped', () => {
    const onConfirm = jest.fn();
    const { getByTestId } = render(
      <SirenGroupPromptModal
        visible
        onConfirm={onConfirm}
        onDismiss={jest.fn()}
        initialGroupSize={1}
      />,
    );
    fireEvent.press(getByTestId('siren-prompt-group-size-inc'));
    fireEvent.press(getByTestId('siren-prompt-group-size-inc'));  // now 3
    fireEvent.press(getByTestId('siren-prompt-confirm'));
    expect(onConfirm).toHaveBeenCalledWith(3);
  });

  it('fires onDismiss when סגור is tapped (no onConfirm fired)', () => {
    const onConfirm = jest.fn();
    const onDismiss = jest.fn();
    const { getByTestId } = render(
      <SirenGroupPromptModal
        visible
        onConfirm={onConfirm}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.press(getByTestId('siren-prompt-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('fires onDismiss when the backdrop is tapped', () => {
    const onDismiss = jest.fn();
    const { getByTestId } = render(
      <SirenGroupPromptModal
        visible
        onConfirm={jest.fn()}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.press(getByTestId('siren-prompt-backdrop'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('seeds the stepper with initialGroupSize', () => {
    const { getByTestId } = render(
      <SirenGroupPromptModal
        visible
        onConfirm={jest.fn()}
        onDismiss={jest.fn()}
        initialGroupSize={5}
      />,
    );
    expect(getByTestId('siren-prompt-group-size-value').props.children).toBe(5);
  });
});
