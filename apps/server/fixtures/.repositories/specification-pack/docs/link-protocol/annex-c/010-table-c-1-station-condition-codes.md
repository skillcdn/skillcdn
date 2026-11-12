---
title: TABLE C-1 Station condition codes
description: The twelve codes a buoy reports its condition with, from nominal to keeper aboard, each with what it means.
---
*Tidewater Link Protocol, third edition > Annex C Code tables*

# Annex C Code tables

## TABLE C-1 Station condition codes

A buoy reports one condition in every confirmation and every report, as a [StationCondition](../06-messages/010-6.1-message-definitions.md#6.1.11).

| Code | Condition | Meaning |
|---|---|---|
| 0 | Nominal | Nothing to report. |
| 1 | Lamp dim | The lamp draws less than its rated current. |
| 2 | Lamp out | The lamp draws no current. |
| 3 | Battery low | The battery is under a third of its charge. |
| 4 | Battery critical | The battery will not last the night. |
| 5 | Off station | The buoy is more than its swing circle from its charted place. |
| 6 | Listing | The buoy leans more than fifteen degrees. |
| 7 | Flooded | Water was detected in the float. |
| 8 | Struck | A shock above the threshold was recorded. |
| 9 | Sensor fault | A sensor answers out of its range. |
| 10 | Clock drift | The clock is more than a second off the window. |
| 11 | Keeper aboard | The service hatch is open. |
