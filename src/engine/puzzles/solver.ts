/* eslint-disable @typescript-eslint/no-explicit-any */
import { puzzleGeneratedSchema, puzzleProofSchema } from '../../shared/puzzle'
import type { PuzzleCore, PuzzleGenerated, PuzzleProof, ReadBackClue } from '../../shared/puzzle'
import {
  generate,
  solve,
  renderText,
  checkText,
  checkAccusation,
  checkMarks,
  checkSolution,
  checkPresent
} from '../../shared/puzzles'

export const PUZZLES_VERSION = 'edu_puzzles 1.0'

/** The old Python-based tools took options here; the solver is pure TypeScript now. The parameter is kept so callers need no change. */
export interface PuzzlePython {
  timeoutMs?: number
}

export type PuzzleCliOptions = PuzzlePython

export interface PuzzleTextCheck {
  ok: boolean
  problems: { clue: string; problem: string }[]
  differing: string[]
}

export class PuzzleToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PuzzleToolError'
  }
}

export class PuzzleCliError extends PuzzleToolError {
  constructor(message: string) {
    super(message)
    this.name = 'PuzzleCliError'
  }
}

export type GeneratedPuzzle = PuzzleGenerated

/**
 * A new puzzle: the core and the canonical English names and sentences.
 * Pure TypeScript implementation (no Python spawn needed).
 */
export async function generatePuzzle(
  _py?: PuzzlePython,
  o: {
    kind?: string
    size?: number | null
    band?: string
    seed?: number
    motive?: boolean
    attrs?: boolean
    count?: number
  } = {}
): Promise<PuzzleGenerated> {
  try {
    const p = generate({
      kind: o.kind ?? 'murdle',
      size: o.size,
      band: o.band ?? 'medium',
      seed: o.seed ?? 1,
      motive: o.motive,
      attrs: o.attrs,
      count: o.count
    })
    const parsed = puzzleGeneratedSchema.safeParse(p)
    if (!parsed.success) {
      throw new PuzzleToolError(`the puzzle engine produced an unexpected shape: ${parsed.error.issues[0]?.message ?? 'invalid'}`)
    }
    return parsed.data
  } catch (err: any) {
    if (err instanceof PuzzleToolError) throw err
    throw new PuzzleToolError(err.message ?? String(err))
  }
}

/**
 * The proof of a core: exactly one solution, solvable by deduction alone, its band, its steps.
 * Pure TypeScript implementation.
 */
export async function solvePuzzle(_py: PuzzlePython | undefined, core: PuzzleCore): Promise<PuzzleProof> {
  try {
    const proof = solve(core)
    const parsed = puzzleProofSchema.safeParse(proof)
    if (!parsed.success) {
      throw new PuzzleToolError(`the puzzle solver answered with an unexpected shape: ${parsed.error.issues[0]?.message ?? 'invalid'}`)
    }
    return parsed.data
  } catch (err: any) {
    if (err instanceof PuzzleToolError) throw err
    throw new PuzzleToolError(err.message ?? String(err))
  }
}

/**
 * The canonical English sentences of a core with these names.
 * Pure TypeScript implementation.
 */
export async function renderPuzzleText(
  _py: PuzzlePython | undefined,
  core: PuzzleCore,
  names?: Record<string, string>
): Promise<{ names: Record<string, string>; text: Record<string, string> }> {
  try {
    return renderText(core, names)
  } catch (err: any) {
    throw new PuzzleToolError(err.message ?? String(err))
  }
}

/**
 * The flavour check: the reader's clues (written from the prose alone) must mean the same as the originals.
 * Pure TypeScript implementation.
 */
export async function checkPuzzleText(
  _py: PuzzlePython | undefined,
  puzzle: PuzzleCore & { names: Record<string, string> },
  readBack: ReadBackClue[],
  text?: Record<string, string>
): Promise<PuzzleTextCheck> {
  try {
    return checkText(puzzle, readBack, text)
  } catch (err: any) {
    throw new PuzzleToolError(err.message ?? String(err))
  }
}

/**
 * Run CLI-equivalent command in pure TypeScript (for tools / scripts / backwards compat).
 */
export async function runPuzzleCli(
  cmd: string,
  args: string[] = [],
  input?: unknown,
  _opts?: PuzzleCliOptions
): Promise<any> {
  try {
    if (cmd === 'generate') {
      let kind = 'murdle'
      let size: number | undefined
      let seed = 1
      let band = 'medium'
      let motive = false
      let attrs = false

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--kind') kind = args[++i]!
        else if (args[i] === '--size') size = parseInt(args[++i]!, 10)
        else if (args[i] === '--seed') seed = parseInt(args[++i]!, 10)
        else if (args[i] === '--band') band = args[++i]!
        else if (args[i] === '--motive') motive = true
        else if (args[i] === '--attrs') attrs = true
      }
      return generatePuzzle(undefined, { kind, size, seed, band, motive, attrs })
    }

    if (cmd === 'solve') {
      return solvePuzzle(undefined, input as PuzzleCore)
    }

    if (cmd === 'check-text') {
      const data = input as { puzzle: any; readBack: any[]; text?: Record<string, string> }
      return checkPuzzleText(undefined, data.puzzle, data.readBack, data.text)
    }

    if (cmd === 'render-text') {
      const data = input as { puzzle: any; names?: Record<string, string> }
      return renderPuzzleText(undefined, data.puzzle, data.names)
    }

    if (cmd === 'check') {
      const data = input as { puzzle: any; accusation?: any; marks?: any; statement?: string; evidence?: string; pressed?: string[] }
      const p = data.puzzle
      if (p.kind === 'testimony') {
        return checkPresent(p, data.statement ?? '', data.evidence ?? '', data.pressed ?? [])
      }
      if (p.murder) {
        return {
          accusation: checkAccusation(p, data.accusation ?? {}),
          wrong_marks: checkMarks(p, data.marks ?? {})
        }
      }
      return {
        solution: checkSolution(p, data.marks ?? {}),
        wrong_marks: checkMarks(p, data.marks ?? {})
      }
    }

    throw new PuzzleCliError(`unknown command "${cmd}"`)
  } catch (err: any) {
    if (err instanceof PuzzleCliError) throw err
    throw new PuzzleCliError(err.message ?? String(err))
  }
}
