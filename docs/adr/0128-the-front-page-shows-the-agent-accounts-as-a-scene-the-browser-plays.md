# ADR-0128: The front page shows the agent accounts as a scene the browser plays

- Status: Accepted
- Date: 2026-11-25
- Builds on [ADR-0047](0047-the-console-is-a-separate-repository-built-on-the-published-packages.md) (the reference console, where agent accounts live) and [ADR-0075](0075-a-search-across-the-packs-has-a-page-per-term-that-search-engines-may-list.md) (the sections of the front page, to which this adds one).

## Context

The console's agent accounts, agents that are members of a team, are what the front page is to show first. What they do is a course of events: one is made, told something in a messenger, splits the work with others, asks a person, reports, and does the next job with what it learned of the last. A still picture does not say that, and a paragraph says it to whoever reads paragraphs.

## Decision

1. **A section, `agents`, comes first after the first screen,** before the organizations. A deployment names it in `LANDING_SECTIONS` like any other, and shows it where it names none.
2. **The scene is drawn and played by the page, and is not a video.** It is some twenty kilobytes instead of some megabytes, sharp at every size, laid out again for a phone, and its words are the language packs'.
3. **What moves and when is a score** (`apps/web/src/components/agents-score.ts`): a pure function from where things stand on the stage to the keyframes of each part and the stretch of the pass it moves in. The browser plays one animation a part (`Element.animate`), opacity and transforms alone, every part begun at once. A part rests outside its stretch and a moment at either end of it, its animation is over with its stretch, and a clock begins the pass again. One endless animation a part keeps all of them in effect all the time, and an `endDelay` up to the end of the pass keeps them off Chrome's compositor; either was measured at more than twice the work on the main thread.
4. **It plays by itself and answers to nothing.** There is nothing to press, it plays only while it is on screen, and under reduced motion it stands on one moment of the team at work. Nothing is written beside it to explain it: no captions, no list of steps. It is hidden from assistive technology, and one paragraph says what it shows.
5. **On a phone it fits one screen.** The conversation and the board share one place there, the one behind showing its head over the one in front; a wide screen has them side by side. One score plays both, from what it measures.
6. **That the agents learn is shown, not told.** The answer to a question and the work itself leave a mark beside an agent's name, and the next order, of the same kind, crosses the board at once and without a question. The heading says it in words, since few visitors watch a whole pass. What this stands for is what an agent account does: it keeps what it learned in its desk and in the project's documents, and reads it there for the next task.
7. **In promotion an agent account is called an employee,** "AI employee" and its like in every language pack, in the scene and around it; the documents and the console keep their own word.
8. **Everything in it is invented.** The names are ones the console proposes, the planets are drawn as the console draws an agent account's avatar, and the work is nobody's.

## Consequences

- The windows take their look from the console and from a messenger and are copies of neither; the messenger is named nowhere and its mark is not shown, nor is any other outside service's. A change of the console's pages asks nothing here unless what an agent account does has changed.
- A word of the scene is added to every language pack, and a line that grows may change where the list of messages stands, which is measured on the page rather than written down.
- **Rejected:** a video, for its weight, its one language and its one shape; a library of animation, for a timeline the platform has; a scene the visitor can take hold of, since the console's board further down is that.
