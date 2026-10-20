import vectors from '../../../shared/trend_vectors.json';
import { projectGoal, type ProjectionInput } from './projection';

// The same vectors run in api/tests/test_trend.py.

describe('projectGoal', () => {
  test.each(vectors.projection.map((v) => [v.name, v] as const))('%s', (_, v) => {
    const got = projectGoal(v.input as ProjectionInput);
    expect(got.kind).toBe(v.expect.kind);
    if (got.kind === 'projection' && 'weeks' in v.expect) {
      expect(Math.abs(got.weeks - v.expect.weeks)).toBeLessThanOrEqual(0.01);
      expect(got.date).toBe(v.expect.date);
    }
  });
});
