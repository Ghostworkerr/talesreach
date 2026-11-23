import { DEFAULT_SERVER_PORT } from "@talesreach/shared";
import { createGameServer } from "./app.js";
import { openStore } from "./db/store.js";

const port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
const { store, persistent } = await openStore();
if (!persistent) {
  console.warn("No DATABASE_URL set: accounts are kept in memory and reset when the server restarts.");
}
const server = createGameServer({ store, greet: false });

await server.listen(port, "0.0.0.0");
console.log(`Talesreach server listening on port ${port}`);
