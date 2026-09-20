import { isAuthorized, jsonResponse, unauthorizedResponse } from "./_shared/auth.js";

export default async (request) => {
  if (!isAuthorized(request)) return unauthorizedResponse();
  return jsonResponse(200, { success: true, authenticated: true });
};

export const config = { path: "/api/whoami" };
