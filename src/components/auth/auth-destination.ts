export type AuthArea = "company" | "platform";

export function safeReturnTo(area: AuthArea, requested?: string): string {
  const home = area === "company" ? "/admin" : "/";
  if (!requested || !requested.startsWith("/") || requested.includes("//"))
    return home;
  if (
    /[\\%?#\s]/.test(requested) ||
    requested.split("/").some((part) => part === "." || part === "..")
  )
    return home;
  const path = requested.replace(/\/$/, "") || "/";
  if (area === "company") {
    if (
      path === "/admin" ||
      (path.startsWith("/admin/") &&
        !/^\/admin\/(login|mfa|reset-hasla)(\/|$)/.test(path))
    )
      return path;
    return home;
  }
  if (path === "/" || /^\/(firmy|wiadomosci|konto)(\/|$)/.test(path))
    return path;
  return home;
}
