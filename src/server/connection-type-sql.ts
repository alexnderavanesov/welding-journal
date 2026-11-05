import { sql, type SQLWrapper } from 'drizzle-orm'

// The exact whitespace set used by String.trim()/\s, including legacy NBSP
// and BOM. PostgreSQL's default trim and POSIX space class are different.
const jsWhitespace = '\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'

/** Equivalent to isTConnectionType; deliberately leaves Latin T ordinary. */
export function supportConnectionTypeWhere(column: SQLWrapper) {
  return sql`left(ltrim(coalesce(${column}, ''), ${jsWhitespace}), 1) in ('Т', 'т', 'ᲄ', 'ᲅ')`
}

/** Data-list spelling for the supported Cyrillic/digit alphabet. Translate
 * historical Cyrillic lowercase forms explicitly, independent of libc's age. */
export function normalizedConnectionTypeSql(column: SQLWrapper) {
  return sql<string>`upper(translate(btrim(regexp_replace(coalesce(${column}, ''), ${`[${jsWhitespace}]+`}, ' ', 'g')), 'ᲀᲁᲂᲃᲄᲅᲆᲇᲈ', 'ВДОСТТЪѢꙊ'))`
}
