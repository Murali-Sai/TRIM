import { defaultUnitSystem } from './locale';

test.each([
  ['en-US', 'imperial'],
  ['en', 'imperial'],
  ['es-US', 'imperial'],
  ['en-GB', 'metric'],
  ['en-IN', 'metric'],
  ['de-DE', 'metric'],
  ['ja', 'metric'],
  ['my', 'imperial'],
  [undefined, 'metric'],
  ['not a locale', 'metric'],
])('%s defaults to %s', (locale, expected) => {
  expect(defaultUnitSystem(locale)).toBe(expected);
});
