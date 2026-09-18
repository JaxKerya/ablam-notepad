import type { Metadata } from "next";
export const metadata: Metadata = { title: "İş Fırsatları", description: "Sana uygun fırsatlar, senin için takipte.", robots: { index: false, follow: false } };
export default function JobsLayout({ children }: { children: React.ReactNode }) { return children; }
