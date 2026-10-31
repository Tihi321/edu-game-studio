import { asciiSlug } from '../edu/paths'

/** Words a package segment may not be: the Java keywords and literals (an Android package id is a Java package name). */
export const RESERVED_WORDS: ReadonlySet<string> = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'false', 'final', 'finally',
  'float', 'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'null', 'package', 'private', 'protected', 'public', 'return', 'short',
  'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'true', 'try', 'void', 'volatile', 'while', '_'
])

export const APP_ID_PREFIX = 'org.edustudio'
const SEGMENT = /^[a-z][a-z0-9_]*$/

/**
 * One valid package segment from any text: lower case ASCII letters, digits and `_`; it starts with a letter (`c` is put in front of a
 * leading digit), is never a reserved word (`_app` is added) and is never empty.
 */
export function safeSegment(text: string): string {
  let s = asciiSlug(text, { sep: '_', fallback: 'course', max: 40 })
  if (!/^[a-z]/.test(s)) s = `c${s}`
  if (RESERVED_WORDS.has(s)) s = `${s}_app`
  return s
}

/** `org.edustudio.<segment>` for a course slug (or any text). */
export function appIdFor(slug: string): string {
  return `${APP_ID_PREFIX}.${safeSegment(slug)}`
}

/** The problem with an app id the caller gave, or null when it is a valid Android application id (two or more segments). */
export function appIdProblem(id: string): string | null {
  const parts = id.split('.')
  if (parts.length < 2) return 'needs at least two segments, for example org.example.myapp'
  for (const p of parts) {
    if (!SEGMENT.test(p)) return `segment "${p}" must be lower case letters, digits and _, starting with a letter`
    if (RESERVED_WORDS.has(p)) return `segment "${p}" is a reserved word`
  }
  return null
}
