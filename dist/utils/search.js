// =====================================================================
//  Persian-aware search (2026-11-03, owner voice note «بعضی محصولات نمایش داده نمی‌شوند»)
// ---------------------------------------------------------------------
//  Product names are typed with mixed spellings: «سوییچ» / «سوئیچ»,
//  Arabic «ي/ك» vs Persian «ی/ک», «آداپتور» / «اداپتور», half-space,
//  «۱۲ ولت» / «12 ولت». A plain LIKE missed most of them (e.g. searching
//  «سوییچ» found 10 of 46 switches). Both the column (via nested REPLACE,
//  portable on SQLite *and* MySQL) and the query are normalized the same way.
//  Every word must appear (in any order) in name, SKU or description.
// =====================================================================
const MAP = [
    ['ي', 'ی'], ['ى', 'ی'], ['ئ', 'ی'], ['ك', 'ک'], ['آ', 'ا'], ['أ', 'ا'], ['إ', 'ا'], ['ٱ', 'ا'],
    ['ة', 'ه'], ['ۀ', 'ه'], ['ؤ', 'و'], ['\u200c', ''], ['\u200f', ''], ['\u200e', ''], ['ـ', ''],
    ['۰', '0'], ['۱', '1'], ['۲', '2'], ['۳', '3'], ['۴', '4'], ['۵', '5'], ['۶', '6'], ['۷', '7'], ['۸', '8'], ['۹', '9'],
    ['٠', '0'], ['١', '1'], ['٢', '2'], ['٣', '3'], ['٤', '4'], ['٥', '5'], ['٦', '6'], ['٧', '7'], ['٨', '8'], ['٩', '9'],
    ['یی', 'ی'], // must stay LAST: «سوئیچ»->«سوییچ»->«سویچ» == «سوییچ»->«سویچ»
];
/** JS side — identical rules to faNormSql(). */
export function faNorm(s) {
    let t = String(s ?? '');
    for (const [a, b] of MAP) t = t.split(a).join(b);
    return t.toLowerCase();
}
/** SQL side — nested REPLACE (innermost = first rule). */
export function faNormSql(col) {
    let e = `COALESCE(${col}, '')`;
    for (const [a, b] of MAP) e = `REPLACE(${e}, '${a}', '${b}')`;
    return `LOWER(${e})`;
}
/** Escape LIKE wildcards with '!' (no backslash -> no SQLite/MySQL dialect trouble). */
function likeEsc(t) { return t.replace(/[!%_]/g, (ch) => '!' + ch); }
/**
 * Build " AND (...)" for a free-text query.
 * @param {string} q     raw user query
 * @param {string[]} cols  columns to search, e.g. ['p.name','p.sku','p.description']
 * @returns {{ sql: string, params: string[] }}
 */
export function searchClause(q, cols) {
    const tokens = faNorm(q).split(/[\s,،؛;]+/).map(x => x.trim()).filter(Boolean).slice(0, 6);
    if (!tokens.length) return { sql: '', params: [] };
    const normCols = cols.map(faNormSql);
    const parts = [], params = [];
    for (const t of tokens) {
        parts.push('(' + normCols.map(c => `${c} LIKE ? ESCAPE '!'`).join(' OR ') + ')');
        for (let i = 0; i < normCols.length; i++) params.push(`%${likeEsc(t)}%`);
    }
    return { sql: ' AND ' + parts.join(' AND '), params };
}
