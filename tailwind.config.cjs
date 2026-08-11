/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './dist/views/**/*.js',
    './dist/server.js',
    './public/static/js/**/*.js'
  ],
  // Safelist for dynamic classes used at runtime (Persian RTL UI + admin colors)
  safelist: [
    // bg / text colors used dynamically via toast / status badges / icons
    { pattern: /^(bg|text|border|from|to|via)-(red|green|blue|cyan|indigo|purple|pink|amber|yellow|orange|emerald|fuchsia|slate|gray|sky|teal|rose)-(50|100|200|300|400|500|600|700|800|900)$/ },
    // alpha variants used in glow/hover effects
    { pattern: /^(bg|text|border)-(cyan|indigo|emerald|red|amber|purple|fuchsia|blue)-(400|500|600)\/(10|20|30|40|50)$/ },
    // common state / spacing tokens that may not get picked from templates literals
    { pattern: /^(grid|flex|hidden|block|inline-block|w|h|min-w|min-h|max-w|max-h)-/ },
    // common animation / shadow / blur
    'animate-spin','animate-pulse',
    'shadow-sm','shadow','shadow-md','shadow-lg','shadow-xl','shadow-2xl',
    'blur-3xl','backdrop-blur',
    // RTL utilities
    'rtl','ltr',
    'rounded-full','rounded-2xl','rounded-3xl','rounded-xl','rounded-lg','rounded-md','rounded-sm'
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Vazirmatn', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
};
