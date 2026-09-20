import { TestBed, type Mocked } from '@suites/unit';
import axios, { AxiosInstance } from 'axios';
import { CantinarrApiService } from './cantinarr-api.service';
import { SettingsDataService } from '../../settings/settings-data.service';
import { Settings } from '../../settings/entities/settings.entities';

jest.mock('../lib/httpRetry', () => ({ applyHttpRetry: jest.fn() }));
const connection = {
  url: 'http://cantinarr.local/base',
  api_key: 'test-integration-token',
};
const capabilities = {
  version: 1,
  media_types: ['movie', 'tv'],
  request_reset: false,
  live_availability: false,
  identities_read: true,
  instance_ids: ['tv', 'anime'],
  history_coverage: 'retained_cantinarr_records_only',
  identity_source: 'recorded_media_server_links',
};
const item = (id: number, instance = 'tv') => ({
  request_id: id,
  requester_id: 2,
  requester_known: true,
  media_type: 'tv',
  tmdb_id: 100,
  instance_id: instance,
  requested_at: '2026-09-20T12:00:00Z',
  saved_mapping_known: false,
  availability_known: false,
});
const page = (
  items: ReturnType<typeof item>[],
  next: string | null = null,
) => ({
  items,
  next_cursor: next,
  revision: 9,
  page_complete: true,
  retained_history_complete: true,
  history_coverage: 'retained_cantinarr_records_only',
  instance_ids: ['tv', 'anime'],
  unassigned_history: false,
});

describe('Cantinarr connection', () => {
  let service: CantinarrApiService;
  let settings: Mocked<SettingsDataService>;
  let get: jest.Mock;
  beforeEach(async () => {
    const bed = await TestBed.solitary(CantinarrApiService).compile();
    service = bed.unit;
    settings = bed.unitRef.get(SettingsDataService);
    settings.getSettings.mockResolvedValue(
      Object.assign(new Settings(), {
        cantinarr_url: connection.url,
        cantinarr_api_key: connection.api_key,
        seerr_url: 'http://seerr.local',
      }),
    );
    get = jest.fn();
    jest
      .spyOn(axios, 'create')
      .mockReturnValue({ get, defaults: {} } as unknown as AxiosInstance);
  });
  afterEach(() => jest.restoreAllMocks());
  it('reads all requesters and preserves separate TV/anime destinations', async () => {
    get
      .mockResolvedValueOnce({ data: capabilities })
      .mockResolvedValueOnce({ data: page([item(1)], 'next') })
      .mockResolvedValueOnce({ data: page([item(2, 'anime')]) });
    await expect(service.getRequests(connection)).resolves.toEqual([
      item(1),
      item(2, 'anime'),
    ]);
    expect(get).toHaveBeenLastCalledWith('/requests', {
      params: { limit: 250, cursor: 'next' },
    });
    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        maxRedirects: 0,
        headers: { Authorization: `Bearer ${connection.api_key}` },
      }),
    );
  });
  it.each([
    { ...capabilities, version: 2 },
    { ...capabilities, identities_read: false },
    { ...capabilities, instance_ids: [] },
  ])('rejects an incompatible capability contract', async (value) => {
    get.mockResolvedValueOnce({ data: value });
    await expect(service.getRequests(connection)).rejects.toThrow();
    expect(get).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...page([]), page_complete: false },
    { ...page([]), retained_history_complete: false },
    { ...page([]), unassigned_history: true },
    { ...page([]), instance_ids: ['tv'] },
    { ...page([]), next_cursor: undefined },
    page([item(1, 'outside')]),
    page([item(1), item(1)]),
    page([item(2), item(1)]),
  ])('rejects incomplete or inconsistent history', async (value) => {
    get
      .mockResolvedValueOnce({ data: capabilities })
      .mockResolvedValueOnce({ data: value });
    await expect(service.getRequests(connection)).rejects.toThrow();
  });
  it('rejects a changed snapshot instead of returning the first page', async () => {
    get
      .mockResolvedValueOnce({ data: capabilities })
      .mockResolvedValueOnce({ data: page([item(1)], 'next') })
      .mockResolvedValueOnce({ data: { ...page([item(2)]), revision: 10 } });
    await expect(service.getRequests(connection)).rejects.toThrow(
      'history changed',
    );
  });
  it('rejects cursor loops', async () => {
    get
      .mockResolvedValueOnce({ data: capabilities })
      .mockResolvedValueOnce({ data: page([item(1)], 'next') })
      .mockResolvedValueOnce({ data: page([item(2)], 'next') });
    await expect(service.getRequests(connection)).rejects.toThrow(
      'pagination did not advance',
    );
  });
  it('never returns a partial sweep after a network failure', async () => {
    get
      .mockResolvedValueOnce({ data: capabilities })
      .mockResolvedValueOnce({ data: page([item(1)], 'next') })
      .mockRejectedValueOnce(new Error('failure'));
    await expect(service.getRequests(connection)).rejects.toThrow();
  });
  it('masks the stored token and preserves it on unchanged-URL saves', async () => {
    await expect(service.getSettings()).resolves.toEqual({
      ...connection,
      api_key: '****',
    });
    await service.save({ ...connection, api_key: '****' });
    expect(settings.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        cantinarr_api_key: connection.api_key,
        seerr_url: 'http://seerr.local',
      }),
    );
  });
  it('will not forward a saved token to a changed URL', async () => {
    await expect(
      service.save({ url: 'http://other.local', api_key: '****' }),
    ).rejects.toThrow();
    await expect(
      service.getRequests({ url: 'http://other.local', api_key: '****' }),
    ).rejects.toThrow();
    expect(settings.saveSettings).not.toHaveBeenCalled();
    expect(axios.create).not.toHaveBeenCalled();
  });
  it('clears only Cantinarr settings', async () => {
    await service.remove();
    expect(settings.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        cantinarr_url: null,
        cantinarr_api_key: null,
        seerr_url: 'http://seerr.local',
      }),
    );
  });
  it('does not expose upstream errors or credentials in connection feedback', async () => {
    get.mockRejectedValueOnce(
      new Error(`Authorization: Bearer ${connection.api_key}`),
    );
    const result = await service.test(connection);
    expect(result.code).toBe(0);
    expect(JSON.stringify(result)).not.toContain(connection.api_key);
  });
  it('reports successful complete retained-history access', async () => {
    get
      .mockResolvedValueOnce({ data: capabilities })
      .mockResolvedValueOnce({ data: page([]) });
    await expect(service.test(connection)).resolves.toMatchObject({ code: 1 });
  });
});
