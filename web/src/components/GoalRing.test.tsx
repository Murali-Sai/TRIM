import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GoalRing } from './GoalRing';

const goal = {
  kind: 'log_food',
  text: 'Log food on 5 of 7 days',
  done: 3,
  needed: 5,
  complete: false,
} as const;

describe('GoalRing', () => {
  it('fills to the share done and says it in words', () => {
    const { container } = render(<GoalRing goal={goal} />);
    expect(
      screen.getByRole('img', { name: 'Log food on 5 of 7 days: 3 of 5' }),
    ).toBeInTheDocument();
    const arc = container.querySelectorAll('circle')[1];
    const c = 2 * Math.PI * 18;
    expect(arc?.getAttribute('stroke-dasharray')).toBe(`${0.6 * c} ${c}`);
    expect(screen.getByText('3/5')).toBeInTheDocument();
  });

  it('shows a check once complete', () => {
    render(<GoalRing goal={{ ...goal, done: 5, complete: true }} />);
    expect(
      screen.getByRole('img', { name: 'Log food on 5 of 7 days: 5 of 5, done' }),
    ).toBeInTheDocument();
    expect(screen.getByText('✓')).toBeInTheDocument();
  });
});
