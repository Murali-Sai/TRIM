/** The 23 pairing groups (SPEC page 3, Food pairing), in the staple sheet's order. */
export const FOOD_GROUPS: readonly [string, string][] = [
  ['poultry', 'Poultry'],
  ['red_meat', 'Red meat'],
  ['fish_seafood', 'Fish and seafood'],
  ['eggs', 'Eggs'],
  ['tofu_plant_protein', 'Tofu and plant protein'],
  ['beans_legumes', 'Beans and legumes'],
  ['rice_grains', 'Rice and grains'],
  ['pasta', 'Pasta'],
  ['bread_tortillas', 'Bread and tortillas'],
  ['cereal_oats', 'Breakfast cereal and oats'],
  ['potatoes', 'Potatoes'],
  ['vegetables', 'Vegetables'],
  ['fruit', 'Fruit'],
  ['yogurt', 'Yogurt'],
  ['milk', 'Milk'],
  ['cheese', 'Cheese'],
  ['nuts_butters', 'Nuts and nut butters'],
  ['shakes_bars', 'Protein shakes and bars'],
  ['sweets_desserts', 'Sweets and desserts'],
  ['savory_snacks', 'Savory snacks'],
  ['sauces_condiments', 'Sauces and condiments'],
  ['fats_oils', 'Fats and oils'],
  ['mixed_dishes', 'Mixed dishes'],
];

export function groupLabel(key: string | null): string {
  return FOOD_GROUPS.find(([k]) => k === key)?.[1] ?? 'Not set';
}
