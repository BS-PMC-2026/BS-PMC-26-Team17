import React from 'react';
import { Alert, ActivityIndicator } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

import BuildingsDashboard from '../app/buildings-dashboard';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('expo-linking', () => ({ openURL: jest.fn() }));

const mockUseAuth = jest.fn();
jest.mock('@/context/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.spyOn(Alert, 'alert').mockImplementation(() => {});

// ─── Fixture data ─────────────────────────────────────────────────────────────

const PENDING_BUILDING = {
  id: 'b1',
  address: 'Herzl 10',
  city: "Be'er Sheva",
  registrationStatus: 'pending',
  entranceCode: '1234',
  managerUserId: 'user1',
  registrationFileName: 'permit.pdf',
  registrationFileBase64: null,
};

const APPROVED_BUILDING = {
  id: 'b2',
  address: 'Ben Gurion 5',
  city: "Be'er Sheva",
  registrationStatus: 'approved',
  entranceCode: '',
  managerUserId: 'user2',
  registrationFileName: null,
  registrationFileBase64: null,
};

const MOCK_BUILDINGS = [PENDING_BUILDING, APPROVED_BUILDING];

function mockFetchSuccess(buildings = MOCK_BUILDINGS) {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ buildings }),
    } as Response),
  ) as jest.Mock;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAuth.mockReturnValue({
    user: { id: 'admin1', email: 'a@x.com', role: 'admin' },
  });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BuildingsDashboard', () => {

  // 1. Access denied for non-admin
  it('shows access denied message for non-admin users', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'u@x.com', role: 'user' },
    });

    const { getByText, queryByTestId } = render(<BuildingsDashboard />);

    expect(getByText('Access denied')).toBeTruthy();
    expect(queryByTestId('filter-All')).toBeNull();
    expect(queryByTestId('back-button')).toBeNull();
  });

  // 2. Loading indicator shown while fetching
  it('shows a loading indicator while buildings are being fetched', async () => {
    // Never resolves during this test so we stay in loading state
    global.fetch = jest.fn(() => new Promise(() => {})) as jest.Mock;

    const { UNSAFE_getAllByType } = render(<BuildingsDashboard />);

    const indicators = UNSAFE_getAllByType(ActivityIndicator);
    expect(indicators.length).toBeGreaterThan(0);
  });

  // 3. Buildings list rendered with address, city, status badge
  it('renders building rows with address, city and status after fetch', async () => {
    mockFetchSuccess();

    const { getByText, getAllByText } = render(<BuildingsDashboard />);

    await waitFor(() => {
      expect(getByText('Herzl 10')).toBeTruthy();
      expect(getByText('Ben Gurion 5')).toBeTruthy();
    });

    // City appears in both rows
    const cityMatches = getAllByText("Be'er Sheva");
    expect(cityMatches.length).toBeGreaterThanOrEqual(2);

    // Status badges — getAllByText because the filter button also uses the same label
    const pendingMatches = getAllByText('Pending');
    expect(pendingMatches.length).toBeGreaterThanOrEqual(1);
    const approvedMatches = getAllByText('Approved');
    expect(approvedMatches.length).toBeGreaterThanOrEqual(1);
  });

  // 4. Approve button shown only for pending buildings
  it('shows Approve button only for pending buildings', async () => {
    mockFetchSuccess();

    const { getByTestId, queryByTestId } = render(<BuildingsDashboard />);

    await waitFor(() => {
      expect(getByTestId('approve-b1')).toBeTruthy();   // pending → has button
      expect(queryByTestId('approve-b2')).toBeNull();   // approved → no button
    });
  });

  // 5. Approve button disappears after successful approval
  it('removes the Approve button after a successful approval', async () => {
    mockFetchSuccess();

    const fetchMock = jest.fn()
      // First call: list buildings
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ buildings: MOCK_BUILDINGS }),
      } as Response)
      // Second call: PATCH approve
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ message: 'Building approved', id: 'b1' }),
      } as Response);
    global.fetch = fetchMock as any;

    const { getByTestId, queryByTestId } = render(<BuildingsDashboard />);

    // Wait for the list to load
    await waitFor(() => expect(getByTestId('approve-b1')).toBeTruthy());

    // Trigger the approve Alert confirmation
    await act(async () => {
      fireEvent.press(getByTestId('approve-b1'));
    });

    // Alert.alert was called — simulate pressing the Approve option (index 1)
    const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
    const approveHandler = alertCall[2][1].onPress;
    await act(async () => {
      await approveHandler();
    });

    // The approve button for b1 should be gone
    await waitFor(() => {
      expect(queryByTestId('approve-b1')).toBeNull();
    });

    // Verify the PATCH was called with the correct URL
    const patchCall = fetchMock.mock.calls[1];
    expect(String(patchCall[0])).toContain('/buildings/b1/approve');
    expect(patchCall[1].method).toBe('PATCH');
  });

  // 6. Filter buttons work: All / Pending / Approved
  it('filters buildings correctly when filter buttons are pressed', async () => {
    mockFetchSuccess();

    const { getByTestId, queryByText, getByText } = render(<BuildingsDashboard />);

    await waitFor(() => {
      expect(getByText('Herzl 10')).toBeTruthy();
      expect(getByText('Ben Gurion 5')).toBeTruthy();
    });

    // Filter: Pending — only pending building visible
    await act(async () => {
      fireEvent.press(getByTestId('filter-pending'));
    });
    expect(getByText('Herzl 10')).toBeTruthy();
    expect(queryByText('Ben Gurion 5')).toBeNull();

    // Filter: Approved — only approved building visible
    await act(async () => {
      fireEvent.press(getByTestId('filter-approved'));
    });
    expect(queryByText('Herzl 10')).toBeNull();
    expect(getByText('Ben Gurion 5')).toBeTruthy();

    // Filter: All — both visible again
    await act(async () => {
      fireEvent.press(getByTestId('filter-All'));
    });
    expect(getByText('Herzl 10')).toBeTruthy();
    expect(getByText('Ben Gurion 5')).toBeTruthy();
  });

  // 7. Stats cards reflect correct counts
  it('displays correct stats for total, pending and approved counts', async () => {
    mockFetchSuccess();

    const { getAllByText } = render(<BuildingsDashboard />);

    await waitFor(() => {
      // totalCount = 2, pendingCount = 1, approvedCount = 1
      const twos = getAllByText('2');
      expect(twos.length).toBeGreaterThanOrEqual(1);
      const ones = getAllByText('1');
      expect(ones.length).toBeGreaterThanOrEqual(2);
    });
  });

  // 8. fetch is called with correct user_id query param
  it('fetches buildings with the admin user_id as query param', async () => {
    mockFetchSuccess();

    render(<BuildingsDashboard />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const url = String((global.fetch as jest.Mock).mock.calls[0][0]);
      expect(url).toContain('buildings');
      expect(url).toContain('user_id=admin1');
    });
  });
});
