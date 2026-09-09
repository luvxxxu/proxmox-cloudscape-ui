/** @type {import("next").NextConfig} */
const nextConfig = {
  reactCompiler: true,
  transpilePackages: [
    "@cloudscape-design/components",
    "@cloudscape-design/component-toolkit",
    "@novnc/novnc",
  ],
};

export default nextConfig;
