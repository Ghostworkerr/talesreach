import type { AccountStore } from "./db/store.js";

/**
 * Server-wide services, set once at start-up. Kept here (not passed through room
 * options) so a client can never inject or override them via join options.
 */
let accountStore: AccountStore | null = null;

export function setAccountStore(store: AccountStore) {
  accountStore = store;
}

export function getAccountStore(): AccountStore {
  if (!accountStore) throw new Error("account store not initialised");
  return accountStore;
}
