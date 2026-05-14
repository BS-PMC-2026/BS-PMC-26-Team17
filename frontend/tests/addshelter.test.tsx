import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import AddShelterScreen from '../app/(tabs)/AddShelter';

// ── Mock useAuth so we can control the user (admin / non-admin / null) ────
const mockUseAuth = jest.fn();
jest.mock('@/context/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

// ── Mock expo-router so router.push doesn't blow up ──────────────────────
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

jest.spyOn(Alert, 'alert');

// Tracks the most recent fetch body so we can assert against it
let lastFetchBody: any = null;
beforeEach(() => {
  jest.clearAllMocks();
  lastFetchBody = null;
  global.fetch = jest.fn((_url, opts: any) => {
    lastFetchBody = JSON.parse(opts.body);
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ message: 'Shelter added', shelter: { id: 'x1' } }),
    } as Response);
  }) as jest.Mock;
});

const adminUser   = { id: 'admin-1', email: 'a@x.com', name: 'Admin', role: 'admin' };
const regularUser = { id: 'user-1',  email: 'u@x.com', name: 'User',  role: 'user'  };

describe('AddShelter Screen', () => {

  // ─────────────────────────────────────────────────────────
  // 1. Non-admin sees access-denied screen
  // ─────────────────────────────────────────────────────────
  it('shows "Access Denied" for non-admin users', () => {
    mockUseAuth.mockReturnValue({ user: regularUser });
    const { getByText, queryByPlaceholderText } = render(<AddShelterScreen />);

    expect(getByText(/Access Denied/i)).toBeTruthy();
    expect(queryByPlaceholderText(/Herzl St/i)).toBeNull(); // form not rendered
  });

  // ─────────────────────────────────────────────────────────
  // 2. Admin sees the form
  // ─────────────────────────────────────────────────────────
  it('renders the full form for admin users', () => {
    mockUseAuth.mockReturnValue({ user: adminUser });
    const { getByText, getByPlaceholderText } = render(<AddShelterScreen />);

    expect(getByText('Add New Shelter')).toBeTruthy();
    expect(getByPlaceholderText(/Herzl St/i)).toBeTruthy();          // name
    expect(getByPlaceholderText('Street and number')).toBeTruthy();   // address
    expect(getByText('+ Add Shelter to Database')).toBeTruthy();      // submit btn
  });

  // ─────────────────────────────────────────────────────────
  // 3. Validation: empty form shows error alert and no fetch
  // ─────────────────────────────────────────────────────────
  it('shows error and skips API call when name+address are empty', async () => {
    mockUseAuth.mockReturnValue({ user: adminUser });
    const { getByText } = render(<AddShelterScreen />);

    fireEvent.press(getByText('+ Add Shelter to Database'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', 'Name and address are required');
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // ─────────────────────────────────────────────────────────
  // 4. Validation: only name (missing address) → error
  // ─────────────────────────────────────────────────────────
  it('shows error when address is missing', async () => {
    mockUseAuth.mockReturnValue({ user: adminUser });
    const { getByText, getByPlaceholderText } = render(<AddShelterScreen />);

    fireEvent.changeText(getByPlaceholderText(/Herzl St/i), 'Only Name');
    fireEvent.press(getByText('+ Add Shelter to Database'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', 'Name and address are required');
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // ─────────────────────────────────────────────────────────
  // 5. Successful submit → fetch called with right body, success alert
  // ─────────────────────────────────────────────────────────
  it('submits the form successfully and shows success alert', async () => {
    mockUseAuth.mockReturnValue({ user: adminUser });
    const { getByText, getByPlaceholderText } = render(<AddShelterScreen />);

    fireEvent.changeText(getByPlaceholderText(/Herzl St/i), 'Beit Test');
    fireEvent.changeText(getByPlaceholderText('Street and number'), 'Test St 5');
    fireEvent.changeText(getByPlaceholderText('Neighborhood name'), 'Old Town');
    fireEvent.changeText(getByPlaceholderText(/North \/ South/), 'North');
    fireEvent.changeText(getByPlaceholderText('Number of people'), '42');

    fireEvent.press(getByText('+ Add Shelter to Database'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    // Verify what we sent to the backend
    expect(lastFetchBody).toMatchObject({
      user_id: 'admin-1',
      name: 'Beit Test',
      address: 'Test St 5',
      neighborhood: 'Old Town',
      area: 'North',
      capacity: 42,
      placeType: 'public shelter',
      accessStatus: 'open',
    });

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Success',
        'Shelter added to database',
        expect.any(Array),
      );
    });
  });

  // ─────────────────────────────────────────────────────────
  // 6. Backend returns 403 → error alert
  // ─────────────────────────────────────────────────────────
  it('shows backend error message when API returns 403', async () => {
    mockUseAuth.mockReturnValue({ user: adminUser });
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ detail: 'Admin access required' }),
      } as Response),
    ) as jest.Mock;

    const { getByText, getByPlaceholderText } = render(<AddShelterScreen />);
    fireEvent.changeText(getByPlaceholderText(/Herzl St/i), 'Beit Test');
    fireEvent.changeText(getByPlaceholderText('Street and number'), 'Test St 5');
    fireEvent.press(getByText('+ Add Shelter to Database'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', 'Admin access required');
    });
  });

  // ─────────────────────────────────────────────────────────
  // 7. Network failure → "Failed to connect to server"
  // ─────────────────────────────────────────────────────────
  it('shows network error when fetch rejects', async () => {
    mockUseAuth.mockReturnValue({ user: adminUser });
    global.fetch = jest.fn(() => Promise.reject(new Error('Network down'))) as jest.Mock;

    const { getByText, getByPlaceholderText } = render(<AddShelterScreen />);
    fireEvent.changeText(getByPlaceholderText(/Herzl St/i), 'Beit Test');
    fireEvent.changeText(getByPlaceholderText('Street and number'), 'Test St 5');
    fireEvent.press(getByText('+ Add Shelter to Database'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', 'Failed to connect to server');
    });
  });

  // ─────────────────────────────────────────────────────────
  // 8. Place-type chip selection updates the submitted value
  // ─────────────────────────────────────────────────────────
  it('changes placeType when a different chip is tapped', async () => {
    mockUseAuth.mockReturnValue({ user: adminUser });
    const { getByText, getByPlaceholderText } = render(<AddShelterScreen />);

    fireEvent.changeText(getByPlaceholderText(/Herzl St/i), 'School Shelter');
    fireEvent.changeText(getByPlaceholderText('Street and number'), 'Edu St 1');
    fireEvent.press(getByText('school'));
    fireEvent.press(getByText('+ Add Shelter to Database'));

    await waitFor(() => {
      expect(lastFetchBody?.placeType).toBe('school');
    });
  });
});
