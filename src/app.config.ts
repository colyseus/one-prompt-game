import {
  defineServer,
  defineRoom,
  monitor,
  playground,
  createRouter,
  createEndpoint,
} from "colyseus";

/**
 * Import your Room files
 */
import { DungeonRoom } from "./rooms/DungeonRoom.js";

// Production runs on the shared demos box (demos.colyseus.cloud/one-prompt-game), where nginx
// routes /one-prompt-game/<port>/ to this process's socket, so seat reservations must carry it.
const production = process.env.COLYSEUS_CLOUD !== undefined;
const port = 2567 + Number(process.env.NODE_APP_INSTANCE || "0");
const publicAddressBase = process.env.PUBLIC_ADDRESS_BASE ?? "demos.colyseus.cloud/one-prompt-game";

const server = defineServer({
  ...(production && { publicAddress: `${publicAddressBase}/${port}` }),

  /**
   * Define your room handlers:
   */
  rooms: {
    // "normal" and "hard" parties never share a dungeon.
    dungeon: defineRoom(DungeonRoom).filterBy(["mode"]),
  },

  /**
   * Experimental: Define API routes. Built-in integration with the "playground" and SDK.
   *
   * Usage from SDK:
   *   client.http.get("/api/hello").then((response) => {})
   *
   */
  routes: createRouter({
    api_hello: createEndpoint("/api/hello", { method: "GET" }, async (ctx) => {
      return { message: "Hello World" };
    }),
    health: createEndpoint("/health", { method: "GET" }, async () => ({ ok: true, time: Date.now() })),
  }),

  /**
   * Bind your custom express routes here:
   * Read more: https://expressjs.com/en/starter/basic-routing.html
   */
  express: (app) => {

    app.get("/hi", (req, res) => {
      res.send("It's time to kick ass and chew bubblegum!");
    });

    /**
     * Use @colyseus/monitor
     * If you expose it in production, make sure to protect it with a password:
     * https://docs.colyseus.io/tools/monitoring#password-protection
     */
    if (process.env.NODE_ENV !== "production") {
      app.use("/monitor", monitor());
    }

    /**
     * Use @colyseus/playground
     * (It is not recommended to expose this route in a production environment)
     */
    if (process.env.NODE_ENV !== "production") {
      app.use("/playground", playground());
    }
  }
});

export default server;

/** Named export read by the `colyseus/vite` plugin's `serverEntry`. */
export { server };
