/**
 * The German rules text the writer roles get as `{{language_rules}}` (EGS-30; the file is EGS-28's, EGS-30 wrote the text). It lives in
 * code, not in `seed/config`, so it is bundled with the engine and every data folder gets it with the app: no seed refresh is involved.
 * Only the item-writer also gets `DE_ITEM_SHAPES` (the `conjugation` shape). Model-written German, not natively reviewed.
 */
export const DE_PROMPT_RULES = `German rules (the taught language is German). These apply to everything you write in German.
Nouns and articles
- Teach every noun with its article and gender (der / die / das), in the singular and the plural ("das Haus, die Häuser"). Never teach a noun without its article. The article is part of the answer for a noun, and a sort-groups item may ask for it on its own (der / die / das).
- The plural is taught with the noun. A typed plural accepts only the right plural, with its umlaut (Bruder / Brüder, Mutter / Mütter).
- The indefinite article (ein / eine) comes only after the definite article is known (from the second A1 unit).
Cases (never teach a case above the level)
- A1: nominative and accusative of the definite and indefinite article and of the personal pronouns; ich / mich / mir only as fixed phrases.
- A2: dative after mit, bei, nach, von, zu, aus, seit and with the two-way prepositions (in, an, auf), each rule stated on its own.
- B1: genitive only as fixed phrases (wegen, trotz) and the relative pronouns.
Verbs
- A conjugation answer is the verb form without the pronoun ("gehe"). Compound tenses and separable verbs include every word the learner types ("bin gegangen", "werde gehen", "würde gehen", "stehe auf"). A reflexive pronoun is part of the answer ("freue mich").
- Imperative persons are only du, ihr and Sie; the Sie form includes the pronoun ("gehen Sie"). er covers er / sie / es, sie is the plural, Sie is the formal address.
- Verb position: second place in a main clause; at the end after weil, dass, ob; the separable prefix at the end ("ich stehe um sieben Uhr auf"); Perfekt as auxiliary in second place and the participle at the end. Say which auxiliary (haben or sein) a verb takes.
- Stem-changing verbs (du fährst, er isst, er liest) get the tag "irregular". Reflexive verbs from A2. Modal verb plus infinitive from A1.
- Use only forms of the correct paradigm: the lint checks each conjugation item against a verb table (CONJ_FORM_MISMATCH, CONJ_VERB_UNKNOWN) and reports a tense above the level of the course (CONJ_TENSE_LEVEL, for example Konjunktiv II at A1).
Sentences
- Cloze and order items for sentence building (words in the right order) are good from A2: verb second in the main clause, time before manner before place from B1.
Spelling
- Write ä ö ü ß exactly. A canonical answer never uses ae / oe / ue / ss for them; the matcher accepts those only as alternates. A missing umlaut is a different word (schon / schön).
- Nouns are capitalised. ß after a long vowel or a diphthong (Straße, heiß), ss after a short vowel (muss, Fluss).
Register
- du for friends, family and children; Sie for strangers and officials. A dialogue item says which one it uses; never mix them in one item.
Accepted answers (language-coach)
- Add real synonyms and optional words. Dropping the pronoun is NOT optional in German (except in the imperative). Accept both du and Sie only when the prompt allows both. Never add a wrong case, gender, plural or verb form as an alternative.
Misconceptions (misconception-designer)
- Croatian speakers: there are no articles in Croatian (they drop or mix der / die / das); the gender follows the natural gender or the Croatian word; word order (the verb is not second); haben or sein in the Perfekt; the du / Sie choice; the double negative.
- English speakers: the verb is not second after another element ("Heute ich gehe"); nouns are not capitalised; false friends (bekommen means get, not become; Gift means poison, not a present; der Chef is the boss, not a cook); plural forms (die Hunde, not "Hunds"); "ich bin kalt" for "mir ist kalt".
- A wrong choice is a mistake one of these learners really makes, never a nonsense word. Its "why" names the misconception and the rule.
Facts and sources
- A grammar fact names its source in the fact's source field: Duden, a Wiktionary page, or a word list of the level (for example the Goethe-Institut Wortliste). The fact-checker checks forms against the cited source and, for a conjugation item, against the lint's verb table: a CONJ_FORM_MISMATCH is a fail.
Feedback (explainer)
- Say the rule in one plain sentence in the language of the course and show a German example ("Nach mit steht der Dativ: mit dem Bus."); do not explain a rule above the level.`

/** What only the item-writer gets for German: the authored shape of the `conjugation` kind (EGS-27). */
export const DE_ITEM_SHAPES = `The conjugation kind (a German verb table drill; use it for the verb units of the scope):
- conjugation: \`"verb": "gehen"\`, \`"tense": "praesens"\` (praesens, praeteritum, perfekt, futur1, konjunktiv2, imperativ), \`"taught": true\`, \`"forms": [{"person": "ich", "accepted": ["gehe"]}, {"person": "du", "accepted": ["gehst"]}, {"person": "er", "accepted": ["geht"]}]\` (2 to 7 forms; persons ich, du, er, wir, ihr, sie, Sie; imperativ only du, ihr, Sie). Each \`accepted\` lists the verb form WITHOUT the pronoun, the canonical form first, then other correct forms ("arbeitest" for du, "wurde" in the Präteritum, "Geh" and "Gehe" for the imperative du). Optional \`"given": ["wir"]\` names forms that are in \`forms\` and are shown filled in, not asked (at least one form must stay asked); optional \`"ask": 3\` asks only that many of the open forms each time (a drill). Compound tenses and separable verbs carry every word the learner types ("bin gegangen", "stehe auf"); the Sie form includes the pronoun ("gehen Sie"). An irregular verb must ask at least one irregular form (du fährst, er liest, ich bin).
- Example: {"id": "u3-q1", "objective": "u3-o1", "kind": "conjugation", "taught": true, "verb": "gehen", "tense": "praesens", "prompt": "Conjugate the verb.", "explanation": "...", "facts": ["f3"], "forms": [{"person": "ich", "accepted": ["gehe"]}, {"person": "du", "accepted": ["gehst"]}, {"person": "wir", "accepted": ["gehen"]}], "given": ["wir"], "ask": 2}`
