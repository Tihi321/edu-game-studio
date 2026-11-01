/**
 * The German rules text the writer roles get as `{{language_rules}}` (EGS-30). EGS-28 owns this file because it landed first; it is a
 * short placeholder with the rules the verb table and the lint already enforce. EGS-30 replaces the text with the full rules.
 */
export const DE_PROMPT_RULES = `German rules (the taught language is German)
- Write ä ö ü ß exactly. Never write ae / oe / ue / ss in a canonical answer; the matcher accepts them as alternates.
- Nouns are capitalised. Teach every noun with its article (der / die / das).
- A conjugation answer is the verb form without the pronoun ("gehe"). Compound tenses and separable verbs include every word the learner types ("bin gegangen", "stehe auf"). A reflexive pronoun is part of the answer ("freue mich").
- Imperative persons are only du, ihr and Sie; the Sie form includes the pronoun ("gehen Sie").
- Use only forms of the correct paradigm: the lint checks the canonical form of each conjugation item against a verb table and reports CONJ_FORM_MISMATCH.
- Tenses above the level of the course (Konjunktiv II, Futur I at A1) are reported as CONJ_TENSE_LEVEL.`
