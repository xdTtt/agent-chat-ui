import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.LANGGRAPH_API_URL ?? "http://localhost:8123/api";

function passthrough(req: NextRequest, method: string) {
  const path = req.nextUrl.pathname.replace(/^\/?api\//, "");
  const search = req.nextUrl.search;
  const target = `${API_URL}/${path}${search}`;

  const headers = new Headers();
  req.headers.forEach((v, k) => {
    if (k.startsWith("host") || k.startsWith("connection")) return;
    headers.set(k, v);
  });

  return req.text().then(async (body) => {
    const opts: RequestInit = { method, headers, body: body || undefined };
    if (!body) delete opts.body;
    const res = await fetch(target, opts);
    return new NextResponse(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  });
}

export const GET = (req: NextRequest) => passthrough(req, "GET");
export const POST = (req: NextRequest) => passthrough(req, "POST");
export const PUT = (req: NextRequest) => passthrough(req, "PUT");
export const PATCH = (req: NextRequest) => passthrough(req, "PATCH");
export const DELETE = (req: NextRequest) => passthrough(req, "DELETE");
export const OPTIONS = () =>
  new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
export const runtime = "nodejs";
