import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /is -> /kariyer: bölüm yeniden adlandırıldı; eski bağlantı ve yer imleri kırılmasın.
  async redirects() {
    return [
      { source: "/is", destination: "/kariyer", permanent: true },
      // Maliyet sayfası yalnız YouTube'a bakıyordu; artık üç sistemi birden gösteriyor
      { source: "/youtube/maliyet", destination: "/maliyet", permanent: true },
    ];
  },
};

export default nextConfig;
