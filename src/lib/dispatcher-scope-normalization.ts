// Exactly the ECMAScript whitespace set used by trim/normalizeJointChainPart.
// Shared by dependency selection and its PostgreSQL expression index.
export const DISPATCHER_SCOPE_WHITESPACE = '\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'
// Keep generated SQL free of literal CR/LF/control bytes so source checkout
// newline conversion cannot silently change the indexed normalization.
export const DISPATCHER_SCOPE_WHITESPACE_SQL = "U&'" + [...DISPATCHER_SCOPE_WHITESPACE]
  .map(character => '\\' + character.charCodeAt(0).toString(16).padStart(4, '0')).join('') + "'"
