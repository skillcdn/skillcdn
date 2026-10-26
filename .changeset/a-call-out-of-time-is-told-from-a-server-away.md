---
"@skillcdn/inference": patch
---

A call that runs out of time fails saying that the inference server did not answer within the call's timeout, and a call that never reached the server says that it could not be reached; both said that the server could not be reached in time, which sent an operator looking for a server that was there and busy. The code of both stays `inference_unreachable`. A timeout while the answer is being read fails the same way, where it was thrown as the body reader gave it.
