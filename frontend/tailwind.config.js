/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      keyframes: {
        failure: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(239, 68, 68, 0.55)', borderColor: 'rgba(239, 68, 68, 0.9)' },
          '50%': { boxShadow: '0 0 22px 4px rgba(239, 68, 68, 0.45)', borderColor: 'rgba(252, 165, 165, 1)' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(12px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
      animation: {
        failure: 'failure 1.4s ease-in-out infinite',
        'slide-up': 'slideUp 0.18s ease-out',
      },
    },
  },
  plugins: [],
};
