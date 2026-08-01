import type { MetadataRoute } from "next";

// Kişisel uygulama: tüm arama motoru ve tarama botlarını dışarıda tut
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}
