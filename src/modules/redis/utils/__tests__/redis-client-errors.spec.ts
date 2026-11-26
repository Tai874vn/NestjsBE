import { EventEmitter } from 'events';
import { watchRedisErrors } from '../redis-client-errors';

describe('watchRedisErrors', () => {
  it('keeps the process alive when a Redis client emits an error', () => {
    const client = new EventEmitter();
    const logger = { warn: jest.fn(), log: jest.fn() };

    watchRedisErrors(client, logger, 'cache');

    expect(() => client.emit('error', new Error('socket closed'))).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('socket closed'));
  });

  it('logs one warning per outage and says when the connection is back', () => {
    const client = new EventEmitter();
    const logger = { warn: jest.fn(), log: jest.fn() };
    watchRedisErrors(client, logger, 'cache');

    client.emit('error', new Error('refused'));
    client.emit('error', new Error('refused'));
    client.emit('ready');

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('reconnected'));
  });
});
