import { ReservationService } from '@/services/ReservationService';

/**
 * Unit tests for the thin reservation API client. Verifies the request
 * shape we send to the backend and that it surfaces failures as rejected
 * promises (so callers can decide to silently log vs. toast).
 *
 * The fetch is mocked per-test; we don't actually hit a backend.
 */

const ORIGINAL_API_URL = process.env.EXPO_PUBLIC_API_URL;

beforeAll(() => {
  // ReservationService reads EXPO_PUBLIC_API_URL at request time, not at
  // module load — setting it here is enough.
  process.env.EXPO_PUBLIC_API_URL = 'http://api.test';
});

afterAll(() => {
  if (ORIGINAL_API_URL === undefined) delete process.env.EXPO_PUBLIC_API_URL;
  else process.env.EXPO_PUBLIC_API_URL = ORIGINAL_API_URL;
});

beforeEach(() => {
  jest.resetAllMocks();
});

describe('ReservationService.reserve', () => {
  it('POSTs to /shelters/{id}/reserve with the snake_case payload', async () => {
    const expected = {
      reservation_id: 'r1', shelter_id: 's1', reservedPlaces: 4,
      actualOccupancy: 0, capacity: 10, isFull: false,
      expiresAt: '2030-01-01T00:00:00Z',
    };
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(expected),
        text: () => Promise.resolve(''),
      } as unknown as Response),
    ) as jest.Mock;

    const result = await ReservationService.reserve({
      shelterId: 's1', userId: 'u1', alertId: 'a1', alertKind: 'siren',
      groupSize: 4,
    });

    expect(result).toEqual(expected);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('http://api.test/shelters/s1/reserve');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(opts.body)).toEqual({
      user_id: 'u1',
      alert_id: 'a1',
      alert_kind: 'siren',
      group_size: 4,
    });
  });

  it('rejects when the backend returns a non-2xx status', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        status: 422,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve('group_size must be <= 20'),
      } as unknown as Response),
    ) as jest.Mock;

    await expect(
      ReservationService.reserve({
        shelterId: 's1', userId: 'u1', alertId: 'a1', alertKind: 'siren',
        groupSize: 50,
      }),
    ).rejects.toThrow(/422/);
  });

  it('rejects when EXPO_PUBLIC_API_URL is unset', async () => {
    const saved = process.env.EXPO_PUBLIC_API_URL;
    delete process.env.EXPO_PUBLIC_API_URL;
    try {
      await expect(
        ReservationService.reserve({
          shelterId: 's1', userId: 'u1', alertId: 'a1', alertKind: 'siren', groupSize: 1,
        }),
      ).rejects.toThrow(/EXPO_PUBLIC_API_URL/);
    } finally {
      process.env.EXPO_PUBLIC_API_URL = saved;
    }
  });
});

describe('ReservationService.release', () => {
  it('POSTs to /shelters/{id}/release with snake_case body', async () => {
    const expected = {
      shelter_id: 's1', released: true,
      reservedPlaces: 0, actualOccupancy: 0, capacity: 10, isFull: false,
    };
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(expected),
        text: () => Promise.resolve(''),
      } as unknown as Response),
    ) as jest.Mock;

    const result = await ReservationService.release({
      shelterId: 's1', userId: 'u1', alertId: 'a1',
    });

    expect(result).toEqual(expected);
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('http://api.test/shelters/s1/release');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ user_id: 'u1', alert_id: 'a1' });
  });

  it('rejects when the backend returns a non-2xx status', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false, status: 404,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve('not found'),
      } as unknown as Response),
    ) as jest.Mock;

    await expect(
      ReservationService.release({ shelterId: 's1', userId: 'u1', alertId: 'a1' }),
    ).rejects.toThrow(/404/);
  });
});

describe('ReservationService.arrive', () => {
  it('POSTs to /shelters/{id}/arrive with snake_case body and returns the new counters', async () => {
    const expected = {
      shelter_id: 's1', promoted: true,
      reservedPlaces: 0, actualOccupancy: 3, capacity: 10, isFull: false,
    };
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(expected),
        text: () => Promise.resolve(''),
      } as unknown as Response),
    ) as jest.Mock;

    const result = await ReservationService.arrive({
      shelterId: 's1', userId: 'u1', alertId: 'a1',
    });

    expect(result).toEqual(expected);
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('http://api.test/shelters/s1/arrive');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ user_id: 'u1', alert_id: 'a1' });
  });

  it('rejects when the backend returns a non-2xx status', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false, status: 500,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve('boom'),
      } as unknown as Response),
    ) as jest.Mock;

    await expect(
      ReservationService.arrive({ shelterId: 's1', userId: 'u1', alertId: 'a1' }),
    ).rejects.toThrow(/500/);
  });
});
