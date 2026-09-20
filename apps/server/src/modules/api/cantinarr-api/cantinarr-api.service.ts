import {
  BasicResponseDto,
  CantinarrSetting,
  cantinarrSettingSchema,
} from '@maintainerr/contracts';
import { BadRequestException, Injectable } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';
import { SettingsDataService } from '../../settings/settings-data.service';
import { Settings } from '../../settings/entities/settings.entities';
import { applyHttpRetry } from '../lib/httpRetry';

const capabilitySchema = z.object({
  version: z.literal(1),
  media_types: z.array(z.enum(['movie', 'tv'])).min(1),
  request_reset: z.literal(false),
  live_availability: z.literal(false),
  identities_read: z.literal(true),
  instance_ids: z.array(z.string().min(1)).min(1),
  history_coverage: z.literal('retained_cantinarr_records_only'),
  identity_source: z.literal('recorded_media_server_links'),
});
const requestSchema = z
  .object({
    request_id: z.number().int().positive(),
    requester_id: z.number().int().positive().nullable(),
    requester_known: z.boolean(),
    media_type: z.enum(['movie', 'tv']),
    tmdb_id: z.number().int().nonnegative(),
    instance_id: z.string().min(1),
    requested_at: z.iso.datetime({ offset: true }),
    saved_mapping_known: z.boolean(),
    availability_known: z.literal(false),
  })
  .passthrough();
const pageSchema = z.object({
  items: z.array(requestSchema).max(250),
  next_cursor: z.string().min(1).max(2048).nullable(),
  revision: z.number().int().nonnegative(),
  page_complete: z.literal(true),
  retained_history_complete: z.literal(true),
  history_coverage: z.literal('retained_cantinarr_records_only'),
  instance_ids: z.array(z.string().min(1)).min(1),
  unassigned_history: z.literal(false),
});
export type CantinarrRequest = z.infer<typeof requestSchema>;

@Injectable()
export class CantinarrApiService {
  constructor(private readonly settings: SettingsDataService) {}

  private async stored(): Promise<Settings> {
    const value = await this.settings.getSettings();
    if (!(value instanceof Settings)) throw new Error('Settings unavailable');
    return value;
  }

  async getSettings(): Promise<CantinarrSetting> {
    const value = await this.stored();
    return {
      url: value.cantinarr_url ?? '',
      api_key: value.cantinarr_api_key ? '****' : '',
    };
  }

  private async resolve(input: CantinarrSetting): Promise<CantinarrSetting> {
    const parsed = cantinarrSettingSchema.parse(input);
    if (parsed.api_key !== '****') return parsed;
    const value = await this.stored();
    // Never forward a saved credential to a newly entered host/base path.
    if (parsed.url !== value.cantinarr_url || !value.cantinarr_api_key) {
      throw new BadRequestException(
        'Enter the integration token when changing the URL.',
      );
    }
    return { url: parsed.url, api_key: value.cantinarr_api_key };
  }

  async save(input: CantinarrSetting): Promise<BasicResponseDto> {
    const resolved = await this.resolve(input);
    const value = await this.stored();
    await this.settings.saveSettings(
      Object.assign(value, {
        cantinarr_url: resolved.url,
        cantinarr_api_key: resolved.api_key,
      }),
    );
    return { status: 'OK', code: 1, message: 'Cantinarr connection saved.' };
  }

  async remove(): Promise<BasicResponseDto> {
    const value = await this.stored();
    await this.settings.saveSettings(
      Object.assign(value, { cantinarr_url: null, cantinarr_api_key: null }),
    );
    return { status: 'OK', code: 1, message: 'Cantinarr connection removed.' };
  }

  private client(config: CantinarrSetting): AxiosInstance {
    const client = axios.create({
      baseURL: `${config.url}/api/integrations/v1`,
      headers: { Authorization: `Bearer ${config.api_key}` },
      timeout: 10000,
      maxRedirects: 0,
      maxContentLength: 5 * 1024 * 1024,
    });
    applyHttpRetry(client);
    return client;
  }

  /** Read every page or throw. A caller must never turn failures into no requests. */
  async getRequests(input: CantinarrSetting): Promise<CantinarrRequest[]> {
    const client = this.client(await this.resolve(input));
    client.defaults.signal = AbortSignal.timeout(60000);
    const capabilities = capabilitySchema.parse(
      (await client.get('/capabilities')).data,
    );
    const authorized = new Set(capabilities.instance_ids);
    const cursors = new Set<string>();
    const ids = new Set<number>();
    const records: CantinarrRequest[] = [];
    let cursor: string | null = null;
    let revision: number | undefined;
    for (let pageNumber = 0; pageNumber < 1000; pageNumber++) {
      const page = pageSchema.parse(
        (
          await client.get('/requests', {
            params: { limit: 250, ...(cursor ? { cursor } : {}) },
          })
        ).data,
      );
      if (
        page.instance_ids.length !== authorized.size ||
        new Set(page.instance_ids).size !== authorized.size ||
        page.instance_ids.some((id) => !authorized.has(id))
      ) {
        throw new Error('Cantinarr authorization scope changed.');
      }
      if (revision !== undefined && page.revision !== revision)
        throw new Error('Cantinarr history changed.');
      revision = page.revision;
      for (const record of page.items) {
        if (
          ids.has(record.request_id) ||
          !authorized.has(record.instance_id) ||
          (records.length &&
            record.request_id <= records[records.length - 1].request_id)
        ) {
          throw new Error('Cantinarr returned inconsistent request history.');
        }
        ids.add(record.request_id);
        records.push(record);
      }
      if (page.next_cursor === null) return records;
      if (!page.items.length || cursors.has(page.next_cursor))
        throw new Error('Cantinarr pagination did not advance.');
      cursors.add(page.next_cursor);
      cursor = page.next_cursor;
    }
    throw new Error(
      'Cantinarr request history exceeds the connection read limit.',
    );
  }

  async test(input: CantinarrSetting): Promise<BasicResponseDto> {
    try {
      await this.getRequests(input);
      return {
        status: 'OK',
        code: 1,
        message:
          'Cantinarr API v1 and complete retained request history are readable. Retention rules require separate instance and identity mapping.',
      };
    } catch {
      // Axios errors can contain the Authorization header. Never log/return them.
      return {
        status: 'NOK',
        code: 0,
        message:
          'Cantinarr connection failed. Check the API v1 integration build, URL, token expiry, identity-read permission, instance grants and history completeness.',
      };
    }
  }
}
