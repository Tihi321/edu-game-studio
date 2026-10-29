import { createHash } from 'node:crypto'

const MAX_NAME = 32

/** A file-name part from a speaker key: lower case [a-z0-9_-], at most 32 characters. Empty when nothing is left. */
export function slugVoiceName(raw: string): string {
  const ascii = String(raw ?? '')
    .replace(/đ/gi, 'dj')
    .normalize('NFKD')
    .replace(/[^ -~]/g, '')
  return ascii
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, MAX_NAME)
    .replace(/^[-_]+|[-_]+$/g, '')
}

export const sha1 = (s: string): string => createHash('sha1').update(s).digest('hex')
