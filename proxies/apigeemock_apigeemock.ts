import { Http } from "../utilities/http";

export async function apigeemock_apigeemockProxy(req: Request): Promise<Response> {
  const path = Http.getPath(req.url);

  const response = await fetch(
    "https://mocktarget.apigee.net" + "/" + path,
    {
      method: req.method,
      headers: {
        Authorization: req.headers.get("authorization") ?? "",
      },
      body: req.body,
    },
  );

  let newResponse = new Response(
    async function* () {
      if (response && response.body) {
        for await (const chunk of response.body) {
          let chunkString = Buffer.from(chunk).toString("utf-8");
          console.log("Chunk received: " + chunkString);
          yield chunkString;
        }
      }
    },
    { status: response.status },
  );

  return newResponse;
}
