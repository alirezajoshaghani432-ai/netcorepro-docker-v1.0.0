/** Storefront-only Tailwind build (used by scripts/perf/build_css.py).
 *  Scope: site + shared views + site.js only (admin keeps the legacy full bundle).
 *  @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './dist/views/site/**/*.js',
    './dist/views/shared/**/*.js',
    './dist/server.js',
    './public/static/js/site.js'
  ],
  safelist: [
    // toast palette built at runtime in site.js (colors[type])
    'bg-green-600', 'bg-red-600', 'bg-blue-600', 'bg-amber-600', 'bg-slate-800',
    'text-white', 'flex-1', 'space-y-2', 'z-[100]', 'fixed', 'top-20', 'left-4',
    'px-4', 'py-3', 'rounded-lg', 'shadow-lg', 'flex', 'items-center', 'gap-3',
    'text-sm', 'text-xs', 'block', 'hidden', 'w-full', 'mt-3'
  ],
  theme: { extend: { fontFamily: { sans: ['Vazirmatn', 'system-ui', 'sans-serif'] } } },
  plugins: []
};
