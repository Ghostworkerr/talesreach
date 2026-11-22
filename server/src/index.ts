import { DEFAULT_SERVER_PORT } from "@talesreach/shared";
import { createGameServer } from "./app.js";

const port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
const server = createGameServer({ greet: false });

await server.listen(port, "0.0.0.0");
console.log(`Talesreach server listening on port ${port}`);
