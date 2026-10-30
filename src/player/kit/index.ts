/**
 * The shell kit (EGS-10): what every game shell after the quiz arena builds on. See docs/player.md, "Shells", for the contract.
 *
 *   ShellSession  edition, progress (shared cards / queue / score, the shell's own stars and data), answering, runs, render, publish
 *   ask()         the shared question screen (item -> feedback -> next), same test ids as the quiz arena
 *   titleScreen() the shared title screen (language, game style, start, export / import / reset)
 *   endScreen()   the shared end screen
 *   makeShellUi() the shell's own words (en + hr tables, `ui.<key>` overrides from the course catalog)
 */
export { ShellSession, NO_IMAGE_KINDS, type AnswerOutcome, type PublishExtra, type SessionOptions } from './session'
export { ask, type AskOptions, type OpenQuestion } from './question'
export { endScreen, languageName, newTitleState, shellName, shellPicker, titleScreen, type EndOptions, type TitleOptions, type TitleState } from './screens'
export { makeShellUi, type ShellStrings, type ShellUi } from './strings'
