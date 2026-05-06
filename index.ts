import { apigee_mockProxy } from "./proxies/apigee_mock";
import { llmProxy } from "./proxies/llm";

const server = Bun.serve({
  port: 8080,
  routes: {
    "/apigeemock/*": apigee_mockProxy,
    "/llm/*": llmProxy,
  },
});

console.log(`Listening on ${server.url}`);
