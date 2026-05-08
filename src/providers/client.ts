import { Client } from "@langchain/langgraph-sdk";

function resolveApiUrl(apiUrl: string): string {
  if (apiUrl.startsWith("/") && typeof window !== "undefined") {
    return window.location.origin + apiUrl;
  }
  return apiUrl;
}

export function createClient(
  apiUrl: string,
  apiKey: string | undefined,
  authScheme: string | undefined,
) {
  return new Client({
    apiKey,
    apiUrl: resolveApiUrl(apiUrl),
    ...(authScheme && {
      defaultHeaders: {
        "X-Auth-Scheme": authScheme,
      },
    }),
  });
}
