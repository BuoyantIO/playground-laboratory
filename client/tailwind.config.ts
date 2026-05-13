import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#003359',
          900: '#003359',
          90: '#1a476a',
          80: '#335c7a',
          70: '#4d708b',
          60: '#66859b',
          50: '#8099ac',
          40: '#99adbd',
          30: '#b2c2cd',
          20: '#ccd6de',
          10: '#e5ebee',
          5: '#f2f5f7',
          3: '#f7f9fa',
        },
        electric: {
          DEFAULT: '#64f9bf',
          50: '#64f9bf80',
          30: '#64f9bf4d',
          20: '#64f9bf33',
        },
        green: '#02ca7c',
        red: {
          DEFAULT: '#e9556f',
          light: '#ff7490',
        },
        yellow: '#ffad09',
        teal: {
          DEFAULT: '#00c1b4',
          light: '#12d1c4',
        },
        lightblue: '#f2f9ff',
        gray1: '#cedde9',
      },
      fontFamily: {
        sans: ['Manrope', 'Arial', 'sans-serif'],
        mono: ['Inconsolata', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        card: '16px',
        button: '24px',
      },
      backgroundImage: {
        'hero-glow':
          'radial-gradient(circle farthest-corner at 90% 0%, #64f9bf80, #ffffff 52%)',
        'card-glow':
          'linear-gradient(39deg, #64f9bf4d, #ffffff)',
      },
    },
  },
};

export default config;
