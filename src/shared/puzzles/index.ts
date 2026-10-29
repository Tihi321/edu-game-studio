/**
 * Pure TypeScript Native Puzzle & Quiz Engine for Edu Studio.
 */

export * from './prng'
export * from './model'
export * from './solver'
export * from './generator'
export * from './flavour'
export * from './knights'
export * from './testimony'
export * from './logic'
export * from './quiz'
export * from './play'
export * from './text'

export { generate, verify } from './generator'
export { solve, bandOf, countSolutions, deduce } from './solver'
export { checkText } from './flavour'
export { renderText, clueText, murderText, stepText } from './text'
