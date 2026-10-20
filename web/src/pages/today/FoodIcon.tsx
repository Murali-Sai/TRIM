import type { ReactNode } from 'react';
import type { FoodCategory } from '../../lib/foodCategory';

// Original line icons drawn for TRIM on a 24 px grid, one per rough food category.
const PATHS: Record<FoodCategory, ReactNode> = {
  protein: (
    <>
      <path d="M14.5 4.5c3 0 5 2.2 5 5 0 3.6-3.4 6-7.5 6H9l-3.5 3.5a1.4 1.4 0 0 1-2-2L7 13.5V11c0-4 3.2-6.5 7.5-6.5Z" />
      <circle cx="14.5" cy="9.5" r="1.3" />
    </>
  ),
  grain: (
    <>
      <path d="M12 21V9" />
      <path d="M12 9c-2.5 0-4-1.8-4-4 2.5 0 4 1.8 4 4Zm0 0c2.5 0 4-1.8 4-4-2.5 0-4 1.8-4 4Z" />
      <path d="M12 14c-2.5 0-4-1.8-4-4 2.5 0 4 1.8 4 4Zm0 0c2.5 0 4-1.8 4-4-2.5 0-4 1.8-4 4Z" />
    </>
  ),
  dairy: (
    <>
      <path d="M9 3h6M9.5 3v3L7 9.5V20a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9.5L14.5 6V3" />
      <path d="M7 13h10" />
    </>
  ),
  produce: (
    <>
      <path d="M12 7c-4-1.5-7 1-7 5.5S8 21 12 19.5c4 1.5 7-2.5 7-7S16 5.5 12 7Z" />
      <path d="M12 7c0-2 1-3.5 3-4" />
    </>
  ),
  fat: <path d="M12 3c3 4.5 6 7.6 6 11a6 6 0 0 1-12 0c0-3.4 3-6.5 6-11Z" />,
  drink: (
    <>
      <path d="M6 4h12l-1.5 16a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1L6 4Z" />
      <path d="M6.6 10h10.8" />
    </>
  ),
  other: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M8.5 12h7M12 8.5v7" />
    </>
  ),
};

export function FoodIcon({ category }: { category: FoodCategory }) {
  return (
    <span className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-secondary">
      <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {PATHS[category]}
      </svg>
    </span>
  );
}
