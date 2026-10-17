import { cmToFtIn, parseDecimal } from './units';

test.each([
  [180.34, { ft: 5, in: 11 }],
  [187.96, { ft: 6, in: 2 }],
  [182.88, { ft: 6, in: 0 }],
  [152.4, { ft: 5, in: 0 }],
])('%s cm shows as %o', (cm, expected) => {
  expect(cmToFtIn(cm)).toEqual(expected);
});

test.each([
  ['80', 80],
  ['80.5', 80.5],
  ['80,5', 80.5],
  [' 176.4 ', 176.4],
  ['', NaN],
  ['abc', NaN],
  ['-5', NaN],
  ['1e3', NaN],
])('parseDecimal(%j) is %s', (raw, expected) => {
  expect(parseDecimal(raw)).toBe(expected);
});
