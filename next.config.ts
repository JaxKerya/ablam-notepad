import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /is -> /kariyer: bölüm yeniden adlandırıldı; eski bağlantı ve yer imleri kırılmasın.
  async redirects() {
    return [{ source: "/is", destination: "/kariyer", permanent: true }];
  },
};

export default nextConfig;
