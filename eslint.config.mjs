import nextConfig from "eslint-config-next";

const config = [
  ...nextConfig,
  {
    ignores: ["src/generated/prisma/**"],
  },
];

export default config;
