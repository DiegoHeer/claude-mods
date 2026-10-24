---
name: ask
description: Re-ask the open questions from your latest message using the AskUserQuestion tool, and keep using it for later questions that offer a real choice.
disable-model-invocation: true
---

Take the questions from your latest message that I have not answered yet, and ask them again using the AskUserQuestion tool. If there are no open questions, say so.

In both cases, from now on, choose how to ask each later question by its type. This holds in every phase (brainstorming, planning, debugging, implementation), after long reasoning or tool calls, and when another skill tells you to ask the next question:

- Use the AskUserQuestion tool for an undecided choice where you can offer 2-4 real options, for example "store it in a file or in the database?".
- Ask in plain text when a question has no real options to offer: a yes/no question, a request to proceed or confirm, or a free-text question such as "what should it be called?".

Stop using the tool only when I tell you to.
