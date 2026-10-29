/**
 * The learning logic of the course contract. Import from here (not from the single files) so the built-in item kinds are registered.
 * Pure TypeScript (no DOM, no node): the browser player bundles it.
 */
import './kinds'

export * from './registry'
export * from './text'
export * from './match'
export * from './checkers'
export * from './srs'
export * from './adaptive'
export * from './prng'
export * from './crossword'
export * from './wordsearch'
export * from './validate'
export * from './load'
