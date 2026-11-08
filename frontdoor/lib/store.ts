// The Aviary's store, read-only. One JSON record per station, keyed
// `station:<id>`, written by the Aviary's front door when a station checks
// in (reclinerhead/aviary, frontdoor/app/api/checkin); this project reads
// the same Upstash Redis database and writes nothing, so the key schema is
// the Aviary's to change.
//
// Credentials: when the Marketplace integration has injected a read-only
// token (KV_REST_API_READ_ONLY_TOKEN beside KV_REST_API_URL), use that one,
// so this project's env cannot write even by mistake. Otherwise
// Redis.fromEnv(), which reads KV_REST_API_URL / KV_REST_API_TOKEN or the
// UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN pair, whichever is set.
//
// No TTL and no staleness check: the last-known address is the best answer
// even when it is old (the Aviary's redirect-regardless-of-age rule).

import { Redis } from "@upstash/redis";

import type { StationRecord } from "./frontdoor";

let client: Redis | null = null;

function redis(): Redis {
  if (!client) {
    const url = process.env["KV_REST_API_URL"];
    const readOnly = process.env["KV_REST_API_READ_ONLY_TOKEN"];
    client = url && readOnly ? new Redis({ url, token: readOnly }) : Redis.fromEnv();
  }
  return client;
}

export async function readStation(id: string): Promise<StationRecord | null> {
  return (await redis().get<StationRecord>(`station:${id}`)) ?? null;
}
