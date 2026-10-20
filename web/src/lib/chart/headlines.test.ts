import { describe, expect, it } from 'vitest';
import {
  caloriesWeekHeadline,
  checkInHeadline,
  dayTooltip,
  isOnTarget,
  macroWeekHeadline,
  measurementHeadline,
  rangeLabel,
  streakHeadline,
  todayHeadline,
  tooLittleData,
  weightHeadline,
  chartLabel,
} from './headlines';

// Fixture numbers are the headline examples in SPEC page 4, "Progress dashboard".

describe('today', () => {
  it('kcal left and protein to go', () => {
    expect(todayHeadline({ kcal: 1974, protein_g: 148 }, { kcal: 2500, protein_g: 150 })).toBe(
      '526 kcal left · 2 g protein to go',
    );
  });
  it('over target uses "over", never alarm words', () => {
    expect(todayHeadline({ kcal: 2542, protein_g: 150 }, { kcal: 2500, protein_g: 150 })).toBe(
      '42 kcal over · protein target met',
    );
  });
  it('exactly on target', () => {
    expect(todayHeadline({ kcal: 2500, protein_g: 160 }, { kcal: 2500, protein_g: 150 })).toBe(
      'Calorie target met · protein target met',
    );
  });
  it('nothing logged yet', () => {
    expect(todayHeadline({ kcal: 0, protein_g: 0 }, { kcal: 2000, protein_g: 120 })).toBe(
      '2,000 kcal left · 120 g protein to go',
    );
  });
});

describe('calories this week', () => {
  it('average and on-target count', () => {
    expect(caloriesWeekHeadline({ average: 2150.4, onTarget: 5, days: 7 })).toBe(
      'Avg 2,150 a day · on target 5 of 7 days',
    );
  });
  it('one day', () => {
    expect(caloriesWeekHeadline({ average: 1800, onTarget: 1, days: 1 })).toBe(
      'Avg 1,800 a day · on target 1 of 1 day',
    );
  });
  it('on target means within 5% either side', () => {
    expect(isOnTarget(2100, 2000)).toBe(true);
    expect(isOnTarget(1900, 2000)).toBe(true);
    expect(isOnTarget(2101, 2000)).toBe(false);
    expect(isOnTarget(1899, 2000)).toBe(false);
  });
});

describe('macros this week', () => {
  it('daily average of target', () => {
    expect(macroWeekHeadline('Protein', 141.6, 150)).toBe('Protein 142 of 150 g a day');
    expect(macroWeekHeadline('Fat', 61, 70)).toBe('Fat 61 of 70 g a day');
  });
});

describe('weight', () => {
  it('trend and weekly change', () => {
    expect(weightHeadline({ trend: 79.84, perWeek: -0.43, unit: 'kg' })).toBe(
      '79.8 kg trend · down 0.4 kg a week',
    );
    expect(weightHeadline({ trend: 176.2, perWeek: 0.62, unit: 'lb' })).toBe(
      '176.2 lb trend · up 0.6 lb a week',
    );
  });
  it('a change that rounds to zero is steady', () => {
    expect(weightHeadline({ trend: 79.8, perWeek: 0.04, unit: 'kg' })).toBe(
      '79.8 kg trend · steady',
    );
  });
});

describe('body measurements', () => {
  it('change since a start date', () => {
    expect(
      measurementHeadline({ metric: 'Waist', change: -2.7, unit: 'cm', since: '2026-09-01' }),
    ).toBe('Waist down 2.7 cm since 1 Sep');
    expect(
      measurementHeadline({ metric: 'Hips', change: 0.5, unit: 'in', since: '2026-01-15' }),
    ).toBe('Hips up 0.5 in since 15 Jan');
    expect(
      measurementHeadline({ metric: 'Neck', change: 0, unit: 'cm', since: '2026-09-01' }),
    ).toBe('Neck unchanged since 1 Sep');
  });
});

describe('streak and goals', () => {
  it('streak days and goals done', () => {
    expect(streakHeadline({ days: 23, goalsDone: 2, goals: 3 })).toBe(
      '23-day streak · 2 of 3 goals done',
    );
  });
  it('no goals this week', () => {
    expect(streakHeadline({ days: 1, goalsDone: 0, goals: 0 })).toBe('1-day streak');
  });
  it('no streak yet invites logging, with no guilt', () => {
    expect(streakHeadline({ days: 0, goalsDone: 0, goals: 3 })).toBe(
      'Log today to start a streak · 0 of 3 goals done',
    );
  });
});

describe("this week's check-in", () => {
  it('average kcal and on-target count', () => {
    expect(checkInHeadline({ average: 2310, onTarget: 5, days: 7 })).toBe(
      'Avg 2,310 kcal, on target 5 of 7 days',
    );
  });
});

describe('tooltips speak in sentences', () => {
  // 14 Oct 2025 was a Tuesday, as in the SPEC example.
  it('under, over and on target', () => {
    expect(dayTooltip('2025-10-14', 2180, 2300)).toBe('Tue 14 Oct: 2,180 kcal, 120 under target');
    expect(dayTooltip('2025-10-15', 2342, 2300)).toBe('Wed 15 Oct: 2,342 kcal, 42 over target');
    expect(dayTooltip('2025-10-16', 2300, 2300)).toBe('Thu 16 Oct: 2,300 kcal, on target');
  });
  it('grams, and no target', () => {
    expect(dayTooltip('2025-10-14', 142, 150, 'g protein')).toBe(
      'Tue 14 Oct: 142 g protein, 8 under target',
    );
    expect(dayTooltip('2025-10-14', 2180, null)).toBe('Tue 14 Oct: 2,180 kcal');
    expect(dayTooltip('2025-10-14', 0, 2300)).toBe('Tue 14 Oct: nothing logged');
  });
});

describe('too little data says what is needed', () => {
  it('names the count still needed', () => {
    expect(tooLittleData('weigh-ins', 3)).toBe('Log 3 more weigh-ins to see your trend');
    expect(tooLittleData('weigh-ins', 1)).toBe('Log 1 more weigh-in to see your trend');
    expect(tooLittleData('days', 2)).toBe('Log 2 more days to see this chart');
    expect(tooLittleData('measurements', 1)).toBe('Log 1 more measurement to see a change');
  });
});

describe('aria labels', () => {
  it('chart, range and headline', () => {
    expect(chartLabel('Calories', '1W', 'Avg 2,150 a day · on target 5 of 7 days')).toBe(
      'Calories chart, last week. Avg 2,150 a day, on target 5 of 7 days.',
    );
    expect(rangeLabel('All')).toBe('all time');
  });
});
