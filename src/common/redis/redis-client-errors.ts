type ErrorSource = {
  on(event: 'error', listener: (error: unknown) => void): unknown;
  on(event: 'ready', listener: () => void): unknown;
};
type Log = { warn(message: string): void; log(message: string): void };

/**
 * A node-redis client emits "error" while it reconnects. Without a listener Node treats that as an unhandled
 * error and exits, so a Redis restart would take the whole API down. Log once per outage instead and let the
 * client reconnect on its own.
 */
export function watchRedisErrors(
  client: ErrorSource,
  logger: Log,
  label: string,
): void {
  let down = false;
  client.on('error', (error: unknown) => {
    if (down) return;
    down = true;
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn(
      `Redis (${label}) unavailable: ${reason}. Retrying in the background.`,
    );
  });
  client.on('ready', () => {
    if (!down) return;
    down = false;
    logger.log(`Redis (${label}) reconnected`);
  });
}

/**
 * Commands fail at once while Redis is down instead of waiting in a queue, so requests fall back to the
 * database rather than hanging.
 */
export const REDIS_CLIENT_OPTIONS = { disableOfflineQueue: true } as const;
