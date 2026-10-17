export const PRODUCT_NAME = 'TRIM';
export const FULL_FORM = 'Track, Record, Inspect, Measure';

type Variant = 'auth' | 'sidebar' | 'header';

// Sizes from SPEC page 1, Name and branding.
const STYLES: Record<Variant, { wrap: string; title: string; fullForm: string }> = {
  auth: {
    wrap: 'text-center',
    title: 'text-[40px] leading-[48px]',
    fullForm: 'text-[16px] leading-6',
  },
  sidebar: {
    wrap: '',
    title: 'text-[24px] leading-8',
    fullForm: 'text-[12px] leading-4',
  },
  header: {
    wrap: '',
    title: 'text-[20px] leading-6',
    fullForm: 'text-[11px] leading-[14px]',
  },
};

interface TitleBlockProps {
  variant: Variant;
  className?: string;
}

/** The TRIM name with its full form underneath; one header so screen readers announce both once. */
export function TitleBlock({ variant, className = '' }: TitleBlockProps) {
  const s = STYLES[variant];
  return (
    <header className={`${s.wrap} ${className}`} data-testid={`title-block-${variant}`}>
      <h1 className={`${s.title} font-bold tracking-tight text-text`}>{PRODUCT_NAME}</h1>
      <p className={`${s.fullForm} whitespace-nowrap text-text-secondary`}>{FULL_FORM}</p>
    </header>
  );
}
