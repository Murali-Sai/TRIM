import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        'surface-2': 'var(--color-surface-2)',
        border: 'var(--color-border)',
        text: 'var(--color-text)',
        'text-secondary': 'var(--color-text-secondary)',
        accent: 'var(--color-accent)',
        'accent-contrast': 'var(--color-accent-contrast)',
        error: 'var(--color-error)',
        kcal: 'var(--color-kcal)',
        protein: 'var(--color-protein)',
        fat: 'var(--color-fat)',
        carbs: 'var(--color-carbs)',
        streak: 'var(--color-streak)',
        'kcal-text': 'var(--color-kcal-text)',
        'protein-text': 'var(--color-protein-text)',
        'fat-text': 'var(--color-fat-text)',
        'carbs-text': 'var(--color-carbs-text)',
      },
      // design-system/MASTER.md: 8 px on cards and controls, 12 px on sheets.
      borderRadius: {
        xl: '0.5rem',
        '2xl': '0.75rem',
      },
      spacing: {
        tabbar: 'var(--tabbar-height)',
        'safe-top': 'env(safe-area-inset-top)',
        'safe-bottom': 'env(safe-area-inset-bottom)',
        'safe-left': 'env(safe-area-inset-left)',
        'safe-right': 'env(safe-area-inset-right)',
      },
    },
  },
  plugins: [],
} satisfies Config;
