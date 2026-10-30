/**
 * A generic driver for a shell that is still a stub on the shell kit (EGS-10 contract): start, then answer every question until the
 * end screen. Each shell ticket replaces its entry in `index.mjs` with its own driver.
 */

export function maxSteps({ pack, factor }) {
  return Math.ceil(4 * pack.items.length * factor) + 20
}

export async function play(bot) {
  const { opts, fail, state, exists, pressAndWait, answerWhileItem, shot, overflowCheck } = bot
  await pressAndWait('start', 'start')
  const s = await answerWhileItem('the stub shell')
  if (s.screen !== 'end') throw new Error(`the stub shell did not reach the end (screen "${s.screen}")`)
  bot.screens.add('end')
  await shot('end')
  await overflowCheck('end')
  for (const id of ['end-title', 'play-again', 'to-title']) if (!(await exists(id))) fail(`the end screen has no ${id}`)
  if (opts.mode === 'wrong' && (await state()).reviewQueue.length === 0) fail('the review queue is empty after answering everything wrong')
}
