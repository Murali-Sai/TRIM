import ref from '../../../shared/reference_day.json';
import { foodCategory } from './foodCategory';

test('reference day foods', () => {
  expect(ref.entries.map((e) => foodCategory(e.name))).toEqual([
    'protein',
    'grain',
    'dairy',
    'produce',
    'fat',
    'protein',
  ]);
});

test('whole words only, and a default', () => {
  expect(foodCategory('Eggplant parmesan')).toBe('other');
  expect(foodCategory('Iced coffee with milk')).toBe('drink');
  expect(foodCategory('Mystery snack')).toBe('other');
});
