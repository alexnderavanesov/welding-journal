/** Database audit JSON excludes credentials and uses ISO strings for dates. */
export type AuditValue = null | boolean | number | string | AuditValue[] | { [key: string]: AuditValue }
