jest.mock('@sentry/nestjs', () => ({
  init: jest.fn(),
}));

import * as Sentry from '@sentry/nestjs';
import type { ErrorEvent } from '@sentry/nestjs';
import {
  beforeSend,
  beforeSendSpan,
  beforeSendTransaction,
  initSentry,
  resolveTracesSampleRate,
  scrubSentryEvent,
  shouldDropTransaction,
} from '../instrument';
import type { SentryStreamedSpan, SentryTransactionEvent } from '../instrument';

describe('instrument (Sentry setup and scrubber)', () => {
  const initMock = Sentry.init as jest.Mock;

  beforeEach(() => {
    initMock.mockClear();
  });

  describe('initSentry', () => {
    it('does not initialize Sentry when SENTRY_DSN is missing or empty', () => {
      expect(initSentry({ NODE_ENV: 'production' })).toBe(false);
      expect(initSentry({ NODE_ENV: 'production', SENTRY_DSN: '' })).toBe(
        false,
      );
      expect(initSentry({ NODE_ENV: 'production', SENTRY_DSN: '   ' })).toBe(
        false,
      );
      expect(initMock).not.toHaveBeenCalled();
    });

    it('initializes Sentry with production defaults when SENTRY_DSN is set', () => {
      const started = initSentry({
        NODE_ENV: 'production',
        SENTRY_DSN: 'https://public@o123.ingest.de.sentry.io/456',
        SENTRY_RELEASE: 'jobaura-backend@1.2.3',
      });

      expect(started).toBe(true);
      expect(initMock).toHaveBeenCalledTimes(1);
      expect(initMock).toHaveBeenCalledWith(
        expect.objectContaining({
          dsn: 'https://public@o123.ingest.de.sentry.io/456',
          environment: 'production',
          release: 'jobaura-backend@1.2.3',
          tracesSampleRate: 1.0,
          dataCollection: expect.objectContaining({
            userInfo: false,
            cookies: false,
            httpBodies: [],
            databaseQueryData: false,
          }),
          beforeSend,
          beforeSendTransaction,
          beforeSendSpan,
        }),
      );
    });

    it('defaults tracesSampleRate to 0 outside production and honors SENTRY_TRACES_SAMPLE_RATE', () => {
      expect(resolveTracesSampleRate({ NODE_ENV: 'development' })).toBe(0);
      expect(resolveTracesSampleRate({ NODE_ENV: 'test' })).toBe(0);
      expect(resolveTracesSampleRate({ NODE_ENV: 'production' })).toBe(1.0);
      expect(
        resolveTracesSampleRate({
          NODE_ENV: 'development',
          SENTRY_TRACES_SAMPLE_RATE: '0.25',
        }),
      ).toBe(0.25);
      expect(
        resolveTracesSampleRate({
          NODE_ENV: 'production',
          SENTRY_TRACES_SAMPLE_RATE: '0',
        }),
      ).toBe(0);
    });
  });

  describe('scrubSentryEvent and beforeSend', () => {
    it('removes cookies, request body, auth/CSRF headers, token query strings, and CV/chat data', () => {
      const sample: ErrorEvent = {
        type: undefined,
        request: {
          url: 'https://api.jobaura.example/api/auth/google/callback?code=secret-code&state=csrf-state',
          method: 'POST',
          query_string: 'code=secret-code&state=csrf-state',
          cookies: {
            access_token: 'jwt-secret',
            refresh_token: 'refresh-secret',
          },
          data: {
            email: 'user@example.com',
            resumeText: 'Full CV content here',
          },
          headers: {
            Authorization: 'Bearer super-secret-jwt',
            Cookie: 'access_token=jwt-secret; refresh_token=refresh-secret',
            'X-CSRF-Token': 'csrf-123',
            'Set-Cookie': 'access_token=new-secret',
            'User-Agent': 'JobAuraTest/1.0',
            'Content-Type': 'application/json',
          },
        },
        user: {
          id: '42',
          email: 'private@example.com',
          ip_address: '203.0.113.10',
        },
        extra: {
          safeKey: 'keep-me',
          cvText: 'Senior engineer CV text',
          resumeData: { Occupation: '2512.3' },
          chatMessage: 'Private salary discussion',
          token: 'raw-token',
        },
        breadcrumbs: [
          {
            category: 'http',
            data: {
              url: 'https://api.jobaura.example/api/payments/vnpay/ipn?vnp_TxnRef=JA1&vnp_SecureHash=sig123',
              headers: {
                Authorization: 'Bearer hidden',
                Accept: 'application/json',
              },
              body: '{"chat":"hello"}',
            },
          },
        ],
      };

      const scrubbed = beforeSend(sample);

      expect(scrubbed.request?.cookies).toBeUndefined();
      expect(scrubbed.request?.data).toBeUndefined();
      expect(scrubbed.request?.url).toBe(
        'https://api.jobaura.example/api/auth/google/callback',
      );
      expect(scrubbed.request?.query_string).toBeUndefined();
      expect(scrubbed.request?.headers).toEqual({
        'User-Agent': 'JobAuraTest/1.0',
        'Content-Type': 'application/json',
      });
      expect(scrubbed.user).toEqual({ id: '42' });
      expect(scrubbed.extra).toEqual({ safeKey: 'keep-me' });
      expect(scrubbed.breadcrumbs?.[0]?.data).toEqual({
        url: 'https://api.jobaura.example/api/payments/vnpay/ipn',
        headers: { Accept: 'application/json' },
      });
    });

    it('scrubs VNPay return query params while keeping harmless query params on normal routes', () => {
      const vnpayReturn = scrubSentryEvent<ErrorEvent>({
        type: undefined,
        request: {
          url: 'https://api.jobaura.example/api/wallet/top-ups/vnpay-return?vnp_Amount=5000000&vnp_SecureHash=abc123',
          query_string: {
            vnp_Amount: '5000000',
            vnp_SecureHash: 'abc123',
          },
        },
      });
      expect(vnpayReturn.request?.url).toBe(
        'https://api.jobaura.example/api/wallet/top-ups/vnpay-return',
      );
      expect(vnpayReturn.request?.query_string).toBeUndefined();

      const normal = scrubSentryEvent<ErrorEvent>({
        type: undefined,
        request: {
          url: 'https://api.jobaura.example/api/jobs?page=2&token=secret',
          query_string: 'page=2&token=secret',
        },
      });
      expect(normal.request?.url).toBe(
        'https://api.jobaura.example/api/jobs?page=2',
      );
      expect(normal.request?.query_string).toBe('page=2');
    });
  });

  describe('beforeSendTransaction and beforeSendSpan', () => {
    it.each([
      'GET /health',
      'GET /api/health',
      'GET /api/health/live',
      'GET /api/health/ready',
      'GET /socket.io/',
      'POST /socket.io/?EIO=4&transport=polling',
    ])('drops noisy transaction %s', (transaction) => {
      const event: SentryTransactionEvent = {
        type: 'transaction',
        transaction,
      };
      expect(shouldDropTransaction(event)).toBe(true);
      expect(beforeSendTransaction(event)).toBeNull();
    });

    it('keeps regular API transactions and scrubs their request data', () => {
      const event: SentryTransactionEvent = {
        type: 'transaction',
        transaction: 'GET /api/jobs',
        request: {
          url: 'https://api.jobaura.example/api/jobs?page=1',
          cookies: { access_token: 'secret' },
          headers: {
            Authorization: 'Bearer secret',
            Host: 'api.jobaura.example',
          },
        },
      };

      const result = beforeSendTransaction(event);

      expect(result).not.toBeNull();
      expect(result?.request?.cookies).toBeUndefined();
      expect(result?.request?.headers).toEqual({ Host: 'api.jobaura.example' });
    });

    it('scrubs sensitive attributes on streamed spans', () => {
      const span: SentryStreamedSpan = {
        trace_id: '1'.repeat(32),
        span_id: '2'.repeat(16),
        name: 'GET /api/payments/vnpay/ipn',
        start_timestamp: 1000,
        status: 'ok',
        is_segment: true,
        attributes: {
          'url.full':
            'https://api.jobaura.example/api/payments/vnpay/ipn?vnp_SecureHash=secret',
          'url.query': 'vnp_SecureHash=secret',
          'http.request.header.authorization': 'Bearer secret',
          'http.request.header.cookie': 'access_token=secret',
          'http.request.header.x-csrf-token': 'csrf',
          'http.response.header.set-cookie': 'access_token=new',
          'http.request.body': '{"resume":"secret"}',
          'http.request.method': 'GET',
        },
      };

      const scrubbed = beforeSendSpan(span);

      expect(scrubbed.attributes).toEqual({
        'url.full': 'https://api.jobaura.example/api/payments/vnpay/ipn',
        'http.request.method': 'GET',
      });
    });
  });
});
