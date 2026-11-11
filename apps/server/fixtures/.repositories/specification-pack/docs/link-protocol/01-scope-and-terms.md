---
title: 1 Scope and terms
description: What the third edition of the Tidewater Link Protocol covers, the terms its clauses use and the abbreviations they are written with.
---
*Tidewater Link Protocol, third edition > 1 Scope and terms*

# 1 Scope and terms

The Tidewater Link Protocol is how a marker buoy and the shore station that tends it keep a link over one radio channel: how the link is set up, kept, lost and taken up again, and what the two say to each other while it holds.

## 1.1 Scope

This edition specifies the link itself. It does not specify the lamp of a buoy or its mooring, which the fitting rules of the harbour board cover, and it does not specify the charts a shore station draws from what it hears.

A reader looks a rule up by the number of its clause. The link procedures are clause 4.2, the message definitions clause 6.1 and the code tables Annex C. What a station reports after an outage is said in 4.2.8, and the conditions it may report are those of TABLE C-1.

## 1.2 Terms

**Bound.** A buoy is bound to a shore station from the confirmation of the link until its release or its loss.

**Carrier.** The steady tone a bound buoy sends between messages, by which the shore station knows the link holds.

**Guard time.** A period a station waits before it acts, so that two stations do not act at once. The guard times of the link are defined in 6.1.8.

**Window.** The part of each minute in which a buoy may send. A buoy that misses its window waits for the next.

## 1.3 Abbreviations

| Abbreviation | Meaning |
|---|---|
| TLP | Tidewater Link Protocol |
| SS | shore station |
| MB | marker buoy |
| KA | keep-alive |
| GT | guard time |
