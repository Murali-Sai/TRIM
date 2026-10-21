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

/** The streak flame (original drawing). */
export function FlameIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 21c-3.6 0-6.5-2.6-6.5-6.2 0-2.9 1.8-4.9 3.4-6.6.3 1.6 1.1 2.7 2.2 3.2-.3-3.3 1.2-6.2 3.9-8.4-.1 2.8 1 4.5 2.4 6.2 1 1.3 1.6 2.8 1.6 4.7 0 4.2-3.2 7.1-7 7.1Z" />
      <path d="M12 21c-1.6 0-2.8-1.2-2.8-2.8 0-1.4 1-2.4 2-3.4.4 1 1 1.5 1.8 1.7.1-.9.6-1.6 1.2-2.2.4.8.7 1.6.7 2.6 0 2.4-1.2 4.1-2.9 4.1Z" />
    </Icon>
  );
}

/** A freeze, shown on days a freeze kept the streak going. */
export function SnowflakeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" />
      <path d="m9.5 4.5 2.5 2 2.5-2M9.5 19.5l2.5-2 2.5 2" />
    </Icon>
  );
}

export function ArrowUpIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </Icon>
  );
}

export function ArrowDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M6 13l6 6 6-6" />
    </Icon>
  );
}

/** Six dots: drag this row to reorder. */
export function GripIcon(props: IconProps) {
  return (
    <Icon {...props}>
      {[8, 12, 16].map((y) => (
        <g key={y} fill="currentColor" stroke="none">
          <circle cx="9" cy={y} r="1.3" />
          <circle cx="15" cy={y} r="1.3" />
        </g>
      ))}
    </Icon>
  );
}

/** Closed padlock: this item stays when shuffling. */
export function LockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </Icon>
  );
}

/** Open padlock: shuffling may change this item. */
export function UnlockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 7.7-1.5" />
    </Icon>
  );
}

export function ShuffleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h3c2.5 0 3.5 1.5 5 5s2.5 5 5 5H20" />
      <path d="M4 17h3c1.2 0 2-.4 2.8-1.2M14.2 8.2c.8-.8 1.6-1.2 2.8-1.2H20" />
      <path d="m17.5 4.5 2.5 2.5-2.5 2.5M17.5 14.5l2.5 2.5-2.5 2.5" />
    </Icon>
  );
}

/** Thumbs down: "Don't suggest these together". */
export function ThumbDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 14V4h9.2a2 2 0 0 1 2 1.6l1.2 6A2 2 0 0 1 18.4 14H14l.8 3.6a2 2 0 0 1-1.9 2.4L8 14Z" />
      <path d="M4 4h4v10H4z" />
    </Icon>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4v11" />
      <path d="m7 10.5 5 5 5-5" />
      <path d="M5 19.5h14" />
    </Icon>
  );
}
