import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  disable: process.env.NODE_ENV !== "production",
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  register: false,
  scope: "/admin/",
  cacheOnNavigation: false,
});

export default withSerwist({
  reactStrictMode: true,
  trailingSlash: true,
  distDir: process.env.AUTERVA_NEXT_DIST_DIR ?? ".next",
});
