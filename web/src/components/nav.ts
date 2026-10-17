import type { ComponentType, SVGProps } from 'react';
import { AccountIcon, BodyIcon, ChartsIcon, LogIcon, TodayIcon } from './icons';

export interface NavItem {
  to: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Today', Icon: TodayIcon },
  { to: '/log', label: 'Log', Icon: LogIcon },
  { to: '/body', label: 'Body', Icon: BodyIcon },
  { to: '/charts', label: 'Charts', Icon: ChartsIcon },
  { to: '/account', label: 'Account', Icon: AccountIcon },
];
