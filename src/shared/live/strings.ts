/** UI texts of the live quiz client (the course's own texts come from its catalog). Unknown languages fall back to English. */
export type LiveStringKey =
  | 'title' | 'join.heading' | 'join.code' | 'join.name' | 'join.button' | 'join.error.code' | 'join.error.name' | 'join.error.taken' | 'join.error.full'
  | 'join.error.started' | 'join.error.rate' | 'join.error.closed' | 'join.error.network'
  | 'lobby.heading' | 'lobby.you' | 'lobby.count' | 'lobby.wait'
  | 'q.progress' | 'q.seconds' | 'q.submit' | 'q.typed' | 'q.locked' | 'q.multi.hint' | 'q.error'
  | 'reveal.correct' | 'reveal.wrong' | 'reveal.none' | 'reveal.answer' | 'reveal.points' | 'reveal.score' | 'reveal.explanation'
  | 'board.heading' | 'board.rank' | 'board.points' | 'podium.heading' | 'podium.place' | 'closed.heading' | 'closed.text' | 'connection.lost'
  | 'tf.true' | 'tf.false'
  | 'host.heading' | 'host.code' | 'host.urls' | 'host.players' | 'host.noplayers' | 'host.start' | 'host.next' | 'host.end' | 'host.close' | 'host.kick' | 'host.answered' | 'host.phase' | 'host.lan'

type Strings = Record<LiveStringKey, string>

const en: Strings = {
  title: 'Live quiz',
  'join.heading': 'Join the quiz',
  'join.code': 'Join code',
  'join.name': 'Your nickname',
  'join.button': 'Join',
  'join.error.code': 'That code is not right.',
  'join.error.name': 'Use 1 to 20 characters for the nickname.',
  'join.error.taken': 'Somebody already uses that nickname.',
  'join.error.full': 'The room is full.',
  'join.error.started': 'The quiz has already started.',
  'join.error.rate': 'Too many tries. Wait a minute.',
  'join.error.closed': 'This quiz has ended.',
  'join.error.network': 'Cannot reach the quiz. Check your connection.',
  'lobby.heading': 'You are in',
  'lobby.you': 'Your nickname: {name}',
  'lobby.count': '{n} players in the room',
  'lobby.wait': 'Waiting for the host to start.',
  'q.progress': 'Question {n} of {total}',
  'q.seconds': '{n} s left',
  'q.submit': 'Lock in answer',
  'q.typed': 'Type your answer',
  'q.locked': 'Answer locked in. Waiting for the others.',
  'q.multi.hint': 'Choose every right answer.',
  'q.error': 'The answer was not accepted. Try again.',
  'reveal.correct': 'Correct!',
  'reveal.wrong': 'Not quite.',
  'reveal.none': 'No answer in time.',
  'reveal.answer': 'The answer: {answer}',
  'reveal.points': '+{n} points',
  'reveal.score': 'Your score: {n}',
  'reveal.explanation': 'Why',
  'board.heading': 'Leaderboard',
  'board.rank': 'Your rank: {rank} of {total}',
  'board.points': '{n} points',
  'podium.heading': 'Podium',
  'podium.place': 'Place {n}',
  'closed.heading': 'The quiz is over',
  'closed.text': 'Thanks for playing.',
  'connection.lost': 'Connection lost. Trying again.',
  'tf.true': 'True',
  'tf.false': 'False',
  'host.heading': 'Host',
  'host.code': 'Join code',
  'host.urls': 'Players open one of these addresses',
  'host.players': 'Players',
  'host.noplayers': 'Nobody has joined yet.',
  'host.start': 'Start',
  'host.next': 'Next',
  'host.end': 'End question',
  'host.close': 'Close room',
  'host.kick': 'Remove {name}',
  'host.answered': '{n} of {total} answered',
  'host.phase': 'Phase: {phase}',
  'host.lan': 'Anyone on this network who knows the code can join.'
}

const hr: Strings = {
  title: 'Kviz uživo',
  'join.heading': 'Pridruži se kvizu',
  'join.code': 'Kod za ulaz',
  'join.name': 'Tvoj nadimak',
  'join.button': 'Uđi',
  'join.error.code': 'Taj kod nije točan.',
  'join.error.name': 'Nadimak mora imati 1 do 20 znakova.',
  'join.error.taken': 'Netko već koristi taj nadimak.',
  'join.error.full': 'Soba je puna.',
  'join.error.started': 'Kviz je već počeo.',
  'join.error.rate': 'Previše pokušaja. Pričekaj minutu.',
  'join.error.closed': 'Ovaj kviz je završio.',
  'join.error.network': 'Kviz nije dostupan. Provjeri vezu.',
  'lobby.heading': 'Ušao si',
  'lobby.you': 'Tvoj nadimak: {name}',
  'lobby.count': 'Igrača u sobi: {n}',
  'lobby.wait': 'Čekamo da voditelj pokrene kviz.',
  'q.progress': 'Pitanje {n} od {total}',
  'q.seconds': 'Preostalo: {n} s',
  'q.submit': 'Zaključaj odgovor',
  'q.typed': 'Upiši odgovor',
  'q.locked': 'Odgovor je zaključan. Čekamo ostale.',
  'q.multi.hint': 'Odaberi sve točne odgovore.',
  'q.error': 'Odgovor nije prihvaćen. Pokušaj ponovno.',
  'reveal.correct': 'Točno!',
  'reveal.wrong': 'Nije točno.',
  'reveal.none': 'Nema odgovora na vrijeme.',
  'reveal.answer': 'Odgovor: {answer}',
  'reveal.points': '+{n} bodova',
  'reveal.score': 'Tvoj rezultat: {n}',
  'reveal.explanation': 'Zašto',
  'board.heading': 'Ljestvica',
  'board.rank': 'Tvoje mjesto: {rank} od {total}',
  'board.points': '{n} bodova',
  'podium.heading': 'Postolje',
  'podium.place': '{n}. mjesto',
  'closed.heading': 'Kviz je gotov',
  'closed.text': 'Hvala na igri.',
  'connection.lost': 'Veza je prekinuta. Pokušavamo ponovno.',
  'tf.true': 'Točno',
  'tf.false': 'Netočno',
  'host.heading': 'Voditelj',
  'host.code': 'Kod za ulaz',
  'host.urls': 'Igrači otvaraju jednu od ovih adresa',
  'host.players': 'Igrači',
  'host.noplayers': 'Još nitko nije ušao.',
  'host.start': 'Pokreni',
  'host.next': 'Dalje',
  'host.end': 'Završi pitanje',
  'host.close': 'Zatvori sobu',
  'host.kick': 'Ukloni {name}',
  'host.answered': 'Odgovorilo {n} od {total}',
  'host.phase': 'Faza: {phase}',
  'host.lan': 'Svatko u ovoj mreži tko zna kod može ući.'
}

export const LIVE_STRINGS: Readonly<Record<string, Strings>> = { en, hr }

/** A translator for a language: `t(key, {n: 3})` fills `{n}`. */
export function liveText(lang: string): (key: LiveStringKey, vars?: Record<string, string | number>) => string {
  const table = LIVE_STRINGS[lang.toLowerCase().split('-')[0] ?? 'en'] ?? en
  return (key, vars) => (table[key] ?? en[key]).replace(/\{(\w+)\}/g, (_m, k: string) => String(vars?.[k] ?? ''))
}
