import { apigeemock_apigeemockProxy } from "./proxies/apigeemock_apigeemock";
import { llmProxy } from "./proxies/llm";

const server = Bun.serve({
  port: 8080,
  routes: {
    "/apigeemock/*": apigeemock_apigeemockProxy,
    "/llm/*": llmProxy,
  },
});

console.log(`Listening on ${server.url}`);
