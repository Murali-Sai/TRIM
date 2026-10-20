import type { SVGProps } from 'react';

// Original line icons drawn for TRIM on a 24 px grid.
type IconProps = SVGProps<SVGSVGElement>;

function Icon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    />
  );
}

export function TodayIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="5" width="16" height="15" rx="2.5" />
      <path d="M8 3v4M16 3v4M4 10h16" />
      <circle cx="12" cy="15" r="1.6" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function LogIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 3v7a2 2 0 0 0 2 2v9M11 3v7a2 2 0 0 1-2 2M9 3v6" />
      <path d="M16.5 21V3c-2 1.5-3 4-3 7 0 1.7 1.3 3 3 3" />
    </Icon>
  );
}

export function BodyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="4" width="17" height="16" rx="3" />
      <path d="M8 9.5a5 5 0 0 1 8 0" />
      <path d="m12 11 1.6-2.4" />
    </Icon>
  );
}

export function ChartsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 20h16" />
      <path d="M7 16v-4M12 16V7M17 16v-6" />
    </Icon>
  );
}

export function AccountIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c.8-3.4 3.6-5.5 7-5.5s6.2 2.1 7 5.5" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

/** A bowl: marks saved meals in lists and on the timeline. */
export function MealIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 11h17a8.5 8.5 0 0 1-17 0Z" />
      <path d="M9 7.5c0-1.2 1-1.6 1-2.8M13.5 7.5c0-1.2 1-1.6 1-2.8" />
      <path d="M8 21h8" />
    </Icon>
  );
}

export function ChevronIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}
