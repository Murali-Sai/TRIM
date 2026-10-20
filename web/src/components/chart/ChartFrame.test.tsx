import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChartFrame, ChartHost, TooLittleData } from './ChartFrame';

const TABLE = {
  caption: 'Calories chart, last week. Avg 2,150 a day, on target 5 of 7 days.',
  columns: ['Day', 'kcal', 'Target'],
  numeric: [1, 2],
  rows: [
    ['Sat 17 Oct', '2,180', '2,300'],
    ['Fri 16 Oct', '2,342', '2,300'],
  ],
};

describe('ChartFrame', () => {
  it('labels the chart with its headline and switches to the same data as a table', () => {
    const onChange = vi.fn();
    render(
      <ChartFrame table={TABLE} range={{ value: '1W', options: ['1W', '1M'], onChange }}>
        <ChartHost label={TABLE.caption} testId="kcal-chart" />
      </ChartFrame>,
    );
    expect(screen.getByRole('img', { name: TABLE.caption })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'last week' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.click(screen.getByRole('radio', { name: 'last month' }));
    expect(onChange).toHaveBeenCalledWith('1M');

    fireEvent.click(screen.getByRole('button', { name: 'View as table' }));
    const table = screen.getByRole('table', { name: TABLE.caption });
    expect(table).toHaveTextContent('Sat 17 Oct2,1802,300');
    expect(screen.getByRole('columnheader', { name: 'kcal' })).toHaveClass('text-right');
    expect(screen.getByTestId('kcal-chart').parentElement).toHaveClass('hidden');
    fireEvent.click(screen.getByRole('button', { name: 'View as chart' }));
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('says what is needed instead of drawing an empty chart', () => {
    render(
      <ChartFrame table={TABLE} tooLittle="Log 2 more days to see this chart">
        <ChartHost label="x" testId="kcal-chart" />
      </ChartFrame>,
    );
    expect(screen.getByTestId('too-little-data')).toHaveTextContent(
      'Log 2 more days to see this chart',
    );
    expect(screen.queryByTestId('kcal-chart')).toBeNull();
    expect(screen.queryByRole('button', { name: 'View as table' })).toBeNull();
  });

  it('too little data on its own', () => {
    render(<TooLittleData message="Log 3 more weigh-ins to see your trend" />);
    expect(screen.getByText('Log 3 more weigh-ins to see your trend')).toBeInTheDocument();
  });
});
