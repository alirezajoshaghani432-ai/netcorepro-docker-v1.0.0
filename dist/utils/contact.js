/**
 * NetCore Pro — contact / chat channels
 * ------------------------------------------------------------------
 * Every "گفتگو با کارشناسان / گفتگوی سریع / ارسال لیست / تلگرام /
 * واتساپ / ایتا / تماس تلفنی" button in the storefront is rendered from
 * THIS list, so an administrator can change every label, link and
 * visibility from  /admin/settings  without touching code.
 *
 * A channel is rendered only when its setting holds a value AND it is not
 * explicitly disabled (`chan_<key>_off = '1'`).
 *
 * The raw setting may be a full URL *or* a bare handle / phone number —
 * `normalize()` turns both into a working href, and also converts Persian
 * and Arabic-Indic digits to ASCII (a `tel:۰۲۵…` href does not dial).
 */

/** Persian/Arabic-Indic digits -> ASCII. */
export function toEnDigits(s) {
    return String(s == null ? '' : s)
        .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06F0))
        .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660));
}

/** Keep only digits (and a leading +) — for tel:/wa.me. */
function digits(s, keepPlus) {
    const t = toEnDigits(s);
    const plus = keepPlus && /^\s*\+/.test(t) ? '+' : '';
    return plus + t.replace(/[^0-9]/g, '');
}

/** 09xxxxxxxxx | +989xx | 989xx | 9xx  ->  989xxxxxxxxx (wa.me / int'l form) */
export function toIntlIran(raw) {
    let d = digits(raw, false);
    if (!d) return '';
    if (d.startsWith('0098')) d = d.slice(4);
    else if (d.startsWith('98')) d = d.slice(2);
    else if (d.startsWith('0')) d = d.slice(1);
    return '98' + d;
}

const isUrl = v => /^(https?:)?\/\//i.test(String(v || '').trim());

/**
 * Channel catalogue. `order` drives the display order everywhere.
 *  - setting  : primary settings key
 *  - fallback : settings key used when the primary one is empty
 *  - type     : how the raw value becomes an href
 */
export const CHANNEL_DEFS = [
    { key: 'call', order: 10, setting: 'contact_phone', fallback: 'phone', type: 'tel', label: 'تماس تلفنی', icon: 'fas fa-phone-volume', cls: 'call', adminLabel: 'شماره تماس (کلیک‌شونده)' },
    { key: 'mobile', order: 20, setting: 'contact_mobile', fallback: 'mobile', type: 'tel', label: 'تماس با موبایل', icon: 'fas fa-mobile-screen', cls: 'mobile', adminLabel: 'شماره موبایل (کلیک‌شونده)' },
    { key: 'whatsapp', order: 30, setting: 'whatsapp', type: 'wa', label: 'واتساپ', icon: 'fab fa-whatsapp', cls: 'wa', adminLabel: 'واتساپ (شماره یا لینک)' },
    { key: 'telegram', order: 40, setting: 'telegram', type: 'tg', label: 'تلگرام', icon: 'fab fa-telegram', cls: 'tg', adminLabel: 'تلگرام (آیدی یا لینک)' },
    { key: 'eitaa', order: 50, setting: 'eitaa', type: 'eitaa', label: 'ایتا', icon: 'fas fa-comment-dots', cls: 'eitaa', adminLabel: 'ایتا (آیدی یا لینک)' },
    { key: 'email', order: 60, setting: 'contact_email', fallback: 'email', type: 'mail', label: 'ارسال لیست / استعلام', icon: 'far fa-envelope', cls: 'mail', adminLabel: 'ایمیل استعلام و ارسال لیست' },
    { key: 'instagram', order: 70, setting: 'instagram', type: 'ig', label: 'اینستاگرام', icon: 'fab fa-instagram', cls: 'ig', adminLabel: 'اینستاگرام (آیدی یا لینک)' }
];

function normalize(type, raw) {
    const v = String(raw || '').trim();
    if (!v) return '';
    switch (type) {
        case 'tel': return 'tel:' + (v.startsWith('+') ? digits(v, true) : '+' + toIntlIran(v));
        case 'wa': return isUrl(v) ? v : 'https://wa.me/' + toIntlIran(v);
        case 'tg': return isUrl(v) ? v : 'https://t.me/' + v.replace(/^@/, '');
        case 'eitaa': return isUrl(v) ? v : 'https://eitaa.com/' + v.replace(/^@/, '');
        case 'ig': return isUrl(v) ? v : 'https://instagram.com/' + v.replace(/^@/, '');
        case 'mail': return v.includes('@') && !isUrl(v) ? 'mailto:' + v : v;
        default: return v;
    }
}

/**
 * Resolve every enabled channel for the current settings.
 * @returns {Array<{key,label,href,icon,cls,display,external}>}
 */
export function getChannels(settings) {
    const s = settings || {};
    const out = [];
    for (const d of [...CHANNEL_DEFS].sort((a, b) => a.order - b.order)) {
        if (s[`chan_${d.key}_off`] === '1') continue;
        const raw = (s[d.setting] || (d.fallback ? s[d.fallback] : '') || '').trim();
        if (!raw) continue;
        const href = normalize(d.type, raw);
        if (!href) continue;
        out.push({
            key: d.key,
            label: (s[`chan_${d.key}_label`] || '').trim() || d.label,
            href,
            icon: d.icon,
            cls: d.cls,
            // human-readable value (phone numbers are shown, handles are not)
            display: d.type === 'tel' ? raw : '',
            external: /^https?:/i.test(href)
        });
    }
    return out;
}

/** Convenience lookup: getChannel(settings, 'whatsapp') */
export function getChannel(settings, key) {
    return getChannels(settings).find(c => c.key === key) || null;
}

/**
 * The single "talk to an expert" href used by compact CTAs
 * (topbar link, buy-box button). Priority is configurable via
 * `chan_primary` and falls back to the first available channel.
 */
export function primaryChannel(settings) {
    const list = getChannels(settings);
    const pref = (settings && settings.chan_primary || '').trim();
    return (pref && list.find(c => c.key === pref)) || list.find(c => c.key === 'whatsapp')
        || list.find(c => c.key === 'telegram') || list.find(c => c.key === 'eitaa') || list[0] || null;
}
