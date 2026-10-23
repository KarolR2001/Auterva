import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  register: false,
  scope: "/admin/",
  cacheOnNavigation: false,
});

export default withSerwist({
  reactStrictMode: true,
  trailingSlash: true,
});
