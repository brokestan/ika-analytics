/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    screens: {
      xs:  '375px',
      sm:  '640px',
      md:  '768px',
      lg:  '1024px',
      xl:  '1280px',
      '2xl': '1536px',
    },
    extend: {
      colors: {
        ika: {
          pink:    '#FF2D78',
          rose:    '#FF5A9E',
          fuchsia: '#FF0066',
          dark:    '#0A0612',
          card:    '#110D1E',
          border:  '#2A1F3D',
          muted:   '#6B5A8E',
          text:    '#E2D9F3',
          dim:     '#8B7BAE',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'sans-serif'],
        mono:    ['var(--font-mono)', 'monospace'],
        body:    ['var(--font-body)', 'sans-serif'],
      },
      backgroundImage: {
        'ika-gradient':  'linear-gradient(135deg, #FF2D78 0%, #FF0066 100%)',
        'card-gradient': 'linear-gradient(135deg, rgba(255,45,120,0.08) 0%, transparent 60%)',
      },
      boxShadow: {
        'ika':    '0 0 30px rgba(255,45,120,0.25), 0 4px 16px rgba(0,0,0,0.4)',
        'ika-sm': '0 0 15px rgba(255,45,120,0.15), 0 2px 8px rgba(0,0,0,0.3)',
        'card':   '0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
      },
    },
  },
  plugins: [],
};
