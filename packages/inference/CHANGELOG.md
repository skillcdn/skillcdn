# @skillcdn/inference

## 0.5.1

### Patch Changes

- [`2dcee75`](https://github.com/skillcdn/skillcdn/commit/2dcee7531d0d8015ae57fb26f97947cc8d0b095d) Thanks [@samo-lucid](https://github.com/samo-lucid)! - A call that embeds documents has its whole timeout once its turn comes. The time it waited for a slot used to come out of it, so a short call that waited behind a long one failed as unanswered within what was left, for the other call's length and not its own. It still waits no longer than the timeout for its turn, and fails as busy when the turn does not come. A query is as before: the wait counts, since a search waits for it.

- [`34b09f2`](https://github.com/skillcdn/skillcdn/commit/34b09f2ae9875d035abfc54b9c7c637a5ae7f653) Thanks [@samo-lucid](https://github.com/samo-lucid)! - A call to an inference server may take as long as its timeout says. The platform's `fetch` ends a call whose answer has not begun after five minutes, whatever the call was given, so `EMBEDDINGS_TIMEOUT_MS` above 300000 never applied and a batch of long texts on a machine without a GPU failed at the same place every time it was tried. `@skillcdn/inference` exports `inferenceFetch`, one call over Node's HTTP client answered as `fetch` answers, which waits for as long as the signal of the call lets it and follows no redirect; the `skillcdn` command hands it to the adapters when it embeds a directory.
- Updated dependencies [[`cb9208d`](https://github.com/skillcdn/skillcdn/commit/cb9208de60152cb0ab8f96e5a0a9675a30133ba4), [`b6972a1`](https://github.com/skillcdn/skillcdn/commit/b6972a12b34eb829f0a1a3305fd428a40639c390), [`4416e43`](https://github.com/skillcdn/skillcdn/commit/4416e43a3a184aa5ced2bbe657198faf054dc9ae), [`6b050be`](https://github.com/skillcdn/skillcdn/commit/6b050bef6e52bdb454f949a8eaf31bdd07706536), [`1475fc3`](https://github.com/skillcdn/skillcdn/commit/1475fc3f296daec0b2cae0140fa1b911df1e3f54), [`6010c2f`](https://github.com/skillcdn/skillcdn/commit/6010c2f50a9f2bf53a0b0dc37b4e2dbad1db0a45), [`75bfccf`](https://github.com/skillcdn/skillcdn/commit/75bfccf4c6c2218bac98a561dfb0b825be47e70b)]:
  - @skillcdn/core@0.5.1

## 0.5.0

### Patch Changes

- Updated dependencies [[`4cd8d35`](https://github.com/skillcdn/skillcdn/commit/4cd8d35cf19062346274a84f5a40bb56aec9931f), [`67c8df3`](https://github.com/skillcdn/skillcdn/commit/67c8df37c41c15f55bbe3016ebbc9a1c3f96831d), [`9b72da2`](https://github.com/skillcdn/skillcdn/commit/9b72da22ee37ec22bb1133825a4795b112db031b), [`fd7d61d`](https://github.com/skillcdn/skillcdn/commit/fd7d61d6e3e34086106cfc227e843a6bf25087fa), [`85264e1`](https://github.com/skillcdn/skillcdn/commit/85264e13a79dd400aae63be18c231b385f22bb23), [`dc29485`](https://github.com/skillcdn/skillcdn/commit/dc29485912bc71c7685838719782d4528f44b7d8), [`ca30bdf`](https://github.com/skillcdn/skillcdn/commit/ca30bdf165cc03632c619852a53c287c5486f720)]:
  - @skillcdn/core@0.5.0

## 0.4.2

### Patch Changes

- Updated dependencies [[`728f791`](https://github.com/skillcdn/skillcdn/commit/728f791d3ec4e1497f0d0d6f2c2b6216ed4cfdcb), [`8aee133`](https://github.com/skillcdn/skillcdn/commit/8aee13321eb11e4341b11f8542d93e68d911cd70), [`284f15d`](https://github.com/skillcdn/skillcdn/commit/284f15d9833dfb7de2e5c5b60150ded713b17285)]:
  - @skillcdn/core@0.4.2

## 0.4.1

### Patch Changes

- [`9797873`](https://github.com/skillcdn/skillcdn/commit/979787324d4367f81539f7fc1c070a4f34f3c2ec) Thanks [@samo-lucid](https://github.com/samo-lucid)! - A call that runs out of time fails saying that the inference server did not answer within the call's timeout, and a call that never reached the server says that it could not be reached; both said that the server could not be reached in time, which sent an operator looking for a server that was there and busy. The code of both stays `inference_unreachable`. A timeout while the answer is being read fails the same way, where it was thrown as the body reader gave it.
- Updated dependencies [[`0f51e91`](https://github.com/skillcdn/skillcdn/commit/0f51e912a1e5da13c97464f708f122fac9444254), [`ca556d3`](https://github.com/skillcdn/skillcdn/commit/ca556d371a24d07895b4c2c6b80f652a9632564f), [`14e1d39`](https://github.com/skillcdn/skillcdn/commit/14e1d39b30ebacaa0e16c78b9c3c31e27befd63b), [`ca556d3`](https://github.com/skillcdn/skillcdn/commit/ca556d371a24d07895b4c2c6b80f652a9632564f)]:
  - @skillcdn/core@0.4.1

## 0.4.0

### Patch Changes

- [`812407f`](https://github.com/skillcdn/skillcdn/commit/812407f7cff74f3973bf40ae25ef3310edb2ba0f) Thanks [@samo-lucid](https://github.com/samo-lucid)! - An answer of an embeddings or reranking server that is not what was expected is described in the error that says so: its type, how many items or characters it has and the names of its keys, never a value, and for an answer that is not JSON its content type and length. A server that answers something else now and then is found by what it answered.

- [`e619aff`](https://github.com/skillcdn/skillcdn/commit/e619aff434e378dc0ec4d5f212d891e042981b06) Thanks [@samo-lucid](https://github.com/samo-lucid)! - New package: the adapters of the common embeddings and reranking APIs for the search by meaning (ADR-0064, ADR-0065, ADR-0066), until now inside the server. `createEmbeddingsApi` and `createRerankApi` implement the `Embedder` and `Reranker` ports of `@skillcdn/core` over the two HTTP shapes inference servers share, bounded by a gate and a breaker, with `withQueryCache` remembering recent queries' vectors and `InferenceError` telling a failure worth a retry from one that is not. The `skillcdn` command and a deployment's server embed and rerank with the same code.
- Updated dependencies [[`cd9e11c`](https://github.com/skillcdn/skillcdn/commit/cd9e11c78a468df5cb546b2936a86fea32e7a204), [`b6ae700`](https://github.com/skillcdn/skillcdn/commit/b6ae700f79f0aebffff60b31cd2a25841c8c0ec7), [`95c13d0`](https://github.com/skillcdn/skillcdn/commit/95c13d0229f5102de02e201b43a498bb8a4e8f76), [`8d532fe`](https://github.com/skillcdn/skillcdn/commit/8d532fe5e5c6dab381f6985e30bf4f5180c8fd93), [`5f1c0fc`](https://github.com/skillcdn/skillcdn/commit/5f1c0fc271d72807f45944fc45cb32f810e67a9a), [`0e2052c`](https://github.com/skillcdn/skillcdn/commit/0e2052c306625d0ebe75513c5e0ada3b4e23e5b5), [`64a6809`](https://github.com/skillcdn/skillcdn/commit/64a6809986b099cc4b098d5cb4dde1be30a7c711), [`7bd391d`](https://github.com/skillcdn/skillcdn/commit/7bd391d54aa43659ee47c3adba9c18f4819d3886), [`5887911`](https://github.com/skillcdn/skillcdn/commit/58879117dce4539aa4746b4f30f3ad159a0c94bc), [`9654820`](https://github.com/skillcdn/skillcdn/commit/9654820d3998cd6bd13e57f806d3c34100ee8090), [`57f0ad6`](https://github.com/skillcdn/skillcdn/commit/57f0ad6aa0ab3c6f4fd092d6923d7650367a9e6e), [`4290804`](https://github.com/skillcdn/skillcdn/commit/42908040e0f255c71e5987470f260c746a9ca4a5), [`a9da901`](https://github.com/skillcdn/skillcdn/commit/a9da901f2a4a6b0f28a5e590e2214b8d700bb710), [`23c5656`](https://github.com/skillcdn/skillcdn/commit/23c56560c7a474a308929e0dad0975d8798f9481), [`4f63a73`](https://github.com/skillcdn/skillcdn/commit/4f63a73adf5a3afdbbe9ae1dfe7ef6e4b7dd39d3), [`a62f704`](https://github.com/skillcdn/skillcdn/commit/a62f704ae441dfed59e188e584eaee54a1d26c43), [`82a10cc`](https://github.com/skillcdn/skillcdn/commit/82a10ccfb756897a0913bc5c7bc84012171d6689), [`7445571`](https://github.com/skillcdn/skillcdn/commit/74455715429a17389c9c6adfbfc448024bd9468b), [`8dbdc10`](https://github.com/skillcdn/skillcdn/commit/8dbdc10ff3aa3598b244c6c754f2f6f5e0981815), [`966a1b4`](https://github.com/skillcdn/skillcdn/commit/966a1b4222021aa217864bbedbe10fafa7c909be)]:
  - @skillcdn/core@0.4.0
