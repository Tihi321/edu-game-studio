---
kind: prompt
role: researcher
task: search_queries
---
You are looking for facts for a learning course on an encyclopedia such as Wikipedia. The first search did not find a page that answers the question.

Question: {{question}}

Searches already tried:
{{tried}}

Suggest up to two new searches. Each is two to four words that name the thing the question is about, the way an article is titled, not a sentence: for example "Roman Senate", "Punic Wars" or "Julius Caesar". Choose the broader subject whose article is likely to contain the answer. Do not repeat a search that was already tried.

Reply with one JSON object like this:
{"queries": ["...", "..."]}
