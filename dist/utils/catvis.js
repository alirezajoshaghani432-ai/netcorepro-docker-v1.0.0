// =====================================================================
//  Category visibility (2026-11-03, owner voice note)
//  «برای دسته‌بندی هم گزینهٔ غیرفعال وقتی می‌زنی کلاً پاک می‌شود»
// ---------------------------------------------------------------------
//  A category with is_active = 0 is HIDDEN from the public site together
//  with all of its sub-categories and their products — but nothing is
//  deleted and products keep their own status, so re-activating the
//  category brings everything back exactly as it was.
// =====================================================================
import db from '../db/index.js';

/** Set of category ids that are hidden (inactive + every descendant). */
export function hiddenCategoryIds() {
    try {
        const rows = db.prepare(`SELECT id, parent_id, COALESCE(is_active, 1) AS a FROM categories`).all();
        const kids = {};
        for (const r of rows) {
            const k = r.parent_id || 0;
            (kids[k] = kids[k] || []).push(r.id);
        }
        const hidden = new Set();
        const stack = rows.filter(r => Number(r.a) === 0).map(r => r.id);
        while (stack.length) {
            const id = stack.pop();
            if (hidden.has(id)) continue;
            hidden.add(id);
            for (const k of (kids[id] || [])) stack.push(k);
        }
        return hidden;
    }
    catch {
        return new Set(); // column missing on a very old DB -> nothing hidden
    }
}

/**
 * SQL fragment (starting with " AND ...") that drops products whose category
 * is hidden. Ids come from the DB and are forced to integers, so inlining is
 * injection-safe. Products without a category stay visible (NULL-safe).
 * @param {string} col  column expression, e.g. 'p.category_id' or 'category_id'
 */
export function catVisSql(col = 'p.category_id', hidden = hiddenCategoryIds()) {
    const ids = [...hidden].map(Number).filter(Number.isInteger);
    return ids.length ? ` AND (${col} IS NULL OR ${col} NOT IN (${ids.join(',')}))` : '';
}

/** Filter helper for category row arrays. */
export function visibleCats(rows, hidden = hiddenCategoryIds()) {
    return (rows || []).filter(c => !hidden.has(Number(c.id)));
}
