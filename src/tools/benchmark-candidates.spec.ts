import {
  parseBenchmarkOptions,
  summarizeTimings,
  measureCandidateScenarios,
  readOnlyDatabaseUrl,
  disconnectBenchmark,
} from './benchmark-candidates';

describe('candidate benchmark measurements', () => {
  it('calculates an even median and nearest-rank p95 without changing samples', () => {
    const samples = [10, 2, 8, 4, 6, 1, 9, 3, 7, 5];
    const original = [...samples];

    expect(summarizeTimings(samples)).toEqual({
      samples: 10,
      min_ms: 1,
      median_ms: 5.5,
      p95_ms: 10,
      max_ms: 10,
    });
    expect(samples).toEqual(original);
  });

  it('calculates an odd median and rounds measurements to two decimal places', () => {
    expect(summarizeTimings([3.333, 1.111, 2.222])).toEqual({
      samples: 3,
      min_ms: 1.11,
      median_ms: 2.22,
      p95_ms: 3.33,
      max_ms: 3.33,
    });
  });

  it.each([{ times: [] }, { times: [NaN] }, { times: [Infinity] }, { times: [-1] }])(
    'rejects invalid timings $times',
    ({ times }) => {
      expect(() => summarizeTimings(times)).toThrow();
    },
  );

  it('uses bounded defaults for repeated measurements', () => {
    expect(parseBenchmarkOptions([])).toEqual({
      samples: 30,
      warmup: 5,
      output: undefined,
      help: false,
    });
  });

  it('accepts an explicit sample count, zero warmups, and a result file', () => {
    expect(
      parseBenchmarkOptions([
        '--samples',
        '50',
        '--warmup',
        '0',
        '--output',
        'docs/performance/before.json',
      ]),
    ).toEqual({
      samples: 50,
      warmup: 0,
      output: 'docs/performance/before.json',
      help: false,
    });
  });

  it.each([
    ['--samples', '0'],
    ['--samples', '1001'],
    ['--samples', '1.5'],
    ['--samples', 'NaN'],
    ['--warmup', '-1'],
    ['--warmup', '101'],
    ['--unknown'],
  ])('rejects invalid benchmark arguments %j', (...args: string[]) => {
    expect(() => parseBenchmarkOptions(args)).toThrow();
  });

  it('excludes warmups from sample statistics and returns no profile data', async () => {
    const service = {
      findCandidates: jest.fn().mockResolvedValue({
        message: 'Get candidates successfully',
        content: {
          data: [{ id: 1, name: 'Private benchmark fixture' }],
          total: 1,
        },
      }),
    };

    const results = await measureCandidateScenarios(service, {
      samples: 2,
      warmup: 1,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(service.findCandidates).toHaveBeenCalledTimes(results.length * 3);
    for (const result of results) {
      expect(result.timing.samples).toBe(2);
      expect(result.matched).toBe(1);
      expect(result.returned).toBe(1);
      expect(result.resultFingerprint).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(JSON.stringify(results)).not.toContain('Private benchmark fixture');
  });

  it('reports query failures instead of publishing incomplete timings', async () => {
    const service = {
      findCandidates: jest.fn().mockRejectedValue(new Error('Database failed')),
    };
    await expect(
      measureCandidateScenarios(service, { samples: 2, warmup: 0 }),
    ).rejects.toThrow('Database failed');
  });

  it.each([
    { total: 2, data: [{ id: 1, name: 'Original' }] },
    { total: 1, data: [{ id: 1, name: 'Changed' }] },
  ])('rejects changing results during a measurement: %j', async (changed) => {
    const service = {
      findCandidates: jest
        .fn()
        .mockResolvedValueOnce({ content: { total: 1, data: [{ id: 1, name: 'Original' }] } })
        .mockResolvedValue({ content: changed }),
    };
    await expect(
      measureCandidateScenarios(service, { samples: 2, warmup: 0 }),
    ).rejects.toThrow('Candidate results changed during directory_page_1');
  });

  it('preserves URL options but makes read-only the final startup setting', () => {
    const input = new URL('postgresql://test:test@localhost:5432/test?sslmode=require');
    input.searchParams.set('options', '-c search_path=public -c default_transaction_read_only=off');
    const output = new URL(readOnlyDatabaseUrl(input.toString()));

    expect(output.searchParams.get('sslmode')).toBe('require');
    expect(output.searchParams.get('options')).toBe(
      '-c search_path=public -c default_transaction_read_only=off -c default_transaction_read_only=on',
    );
  });

  it('enables read-only when a URL has no existing startup options', () => {
    const output = new URL(readOnlyDatabaseUrl('postgresql://test:test@localhost/test'));
    expect(output.searchParams.get('options')).toBe('-c default_transaction_read_only=on');
  });

  it('ends the external pool even if Prisma disconnect fails', async () => {
    const prisma = { $disconnect: jest.fn().mockRejectedValue(new Error('Disconnect failed')) };
    const pool = { end: jest.fn().mockResolvedValue(undefined) };
    await expect(disconnectBenchmark(prisma, pool)).rejects.toThrow('Disconnect failed');
    expect(pool.end).toHaveBeenCalledTimes(1);
  });
});
