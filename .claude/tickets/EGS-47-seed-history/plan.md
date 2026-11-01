# EGS-47 seed history for the HUB-22 seed files

Found in the HUB-22 live check: a data folder whose files lack recorded hashes keeps seed files it cannot recognise as unedited, so config/roles.md (the translator role), config/voice.md, config/languages.md, prompts/voice-director/plan.md and prompts/subject-expert/articles_revise.md never reach it. Fix: add the pre-HUB-22 hashes of these five files to SEED_HISTORY (src/engine/store/seedRefresh.ts). User-edited files are still never overwritten.
