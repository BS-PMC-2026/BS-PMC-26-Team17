import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import GroupSizeStepper from '@/components/GroupSizeStepper';

describe('GroupSizeStepper', () => {
  it('renders the current value', () => {
    const { getByTestId } = render(
      <GroupSizeStepper value={3} onChange={jest.fn()} />,
    );
    expect(getByTestId('group-size-value').props.children).toBe(3);
  });

  it('clamps a value below min when rendered', () => {
    const { getByTestId } = render(
      <GroupSizeStepper value={0} onChange={jest.fn()} />,
    );
    expect(getByTestId('group-size-value').props.children).toBe(1);
  });

  it('clamps a value above max when rendered', () => {
    const { getByTestId } = render(
      <GroupSizeStepper value={50} onChange={jest.fn()} max={20} />,
    );
    expect(getByTestId('group-size-value').props.children).toBe(20);
  });

  it('increments via onChange when + is tapped', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(
      <GroupSizeStepper value={2} onChange={onChange} />,
    );
    fireEvent.press(getByTestId('group-size-inc'));
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it('decrements via onChange when − is tapped', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(
      <GroupSizeStepper value={5} onChange={onChange} />,
    );
    fireEvent.press(getByTestId('group-size-dec'));
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it('disables − at the minimum (does not fire onChange)', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(
      <GroupSizeStepper value={1} onChange={onChange} />,
    );
    fireEvent.press(getByTestId('group-size-dec'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disables + at the maximum (does not fire onChange)', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(
      <GroupSizeStepper value={20} onChange={onChange} max={20} />,
    );
    fireEvent.press(getByTestId('group-size-inc'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('respects a custom testIDPrefix so multiple steppers can coexist', () => {
    const { getByTestId } = render(
      <GroupSizeStepper value={2} onChange={jest.fn()} testIDPrefix="my-prefix" />,
    );
    expect(getByTestId('my-prefix-value').props.children).toBe(2);
    expect(getByTestId('my-prefix-inc')).toBeTruthy();
    expect(getByTestId('my-prefix-dec')).toBeTruthy();
  });
});
