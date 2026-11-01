# EGS-52 bot random hang
Symptom: the pipeline playtest's struggling persona (random, seed 5, accuracy 0.55, quiz-arena) on deutsch-a1-pilot printed "no result (exit 1)".
Finding: the bot is not stuck. By hand it finishes ok (491 answers, ~426 s). src/engine/edu/playtest.ts killed it at the 300 s default timeout, and a killed bot has no JSON, hence "no result".
Fix: default timeout 900 s; a killed bot is reported as "timed out after N s". One test with a fake bot that hangs.
