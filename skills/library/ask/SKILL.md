---
name: ask
description: Re-ask the open questions from your latest message using the AskUserQuestion tool, and keep using it for follow-up questions while we are still deciding.
disable-model-invocation: true
---

Take the questions from your latest message that I have not answered yet, and ask them again using the AskUserQuestion tool. If there are no open questions, say so.

From now on, ask every follow-up question with the AskUserQuestion tool too, not as plain text. This holds after long reasoning, tool calls, or research, and when another skill (such as brainstorming) tells you to ask the next question.

Stop using the tool and ask questions the normal way when either happens:

- The brainstorm or design discussion is done and the work moves on to planning the implementation or writing code.
- I tell you to stop.
