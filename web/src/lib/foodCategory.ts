/**
 * A rough category for an entry's icon, guessed from the food name. Display only; foods carry
 * no category yet. Words are matched whole, first category wins.
 */
export type FoodCategory = 'protein' | 'grain' | 'dairy' | 'produce' | 'fat' | 'drink' | 'other';

const WORDS: [FoodCategory, string[]][] = [
  ['drink', ['coffee', 'tea', 'juice', 'water', 'soda', 'smoothie', 'shake', 'beer', 'wine']],
  [
    'protein',
    [
      'chicken',
      'beef',
      'pork',
      'turkey',
      'fish',
      'salmon',
      'tuna',
      'egg',
      'eggs',
      'tofu',
      'lentil',
      'lentils',
      'beans',
      'steak',
      'shrimp',
    ],
  ],
  ['dairy', ['milk', 'yogurt', 'yoghurt', 'skyr', 'cheese', 'kefir', 'cream', 'curd']],
  [
    'grain',
    [
      'rice',
      'bread',
      'pasta',
      'oats',
      'oatmeal',
      'granola',
      'cereal',
      'wrap',
      'tortilla',
      'bagel',
      'noodles',
      'quinoa',
    ],
  ],
  [
    'produce',
    [
      'apple',
      'banana',
      'berries',
      'orange',
      'grapes',
      'salad',
      'spinach',
      'broccoli',
      'carrot',
      'carrots',
      'tomato',
      'potato',
      'veg',
      'vegetables',
      'fruit',
    ],
  ],
  ['fat', ['oil', 'butter', 'nuts', 'almonds', 'peanut', 'avocado', 'mayonnaise']],
];

export function foodCategory(name: string): FoodCategory {
  const words = new Set(name.toLowerCase().split(/[^a-z]+/));
  for (const [category, list] of WORDS) {
    if (list.some((w) => words.has(w))) return category;
  }
  return 'other';
}
