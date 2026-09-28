import type { Metadata } from "next";
import { Tajawal } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Providers } from "@/components/providers";

const tajawal = Tajawal({
  variable: "--font-tajawal",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "استبيان بيئة العمل والقيادة المؤسسية | مجموعة المرشد",
  description:
    "منصة استبيان موظفين مجهولة الهوية لقياس بيئة العمل والقيادة المؤسسية في مجموعة المرشد.",
  keywords: ["استبيان", "بيئة العمل", "القيادة", "المرشد", "Almarshad"],
  authors: [{ name: "Almarshad Holding" }],
  // Favicon comes from the Next.js file convention: `src/app/icon.png` and
  // `src/app/apple-icon.png` (Almarshad Holding mark).
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={tajawal.variable}
      suppressHydrationWarning
    >
      <body className="antialiased bg-background text-foreground">
        {/*
          next-themes injects its theme script with `fn.toString()`. When a
          bundler adds esbuild's `keepNames` helper (`__name`) to that function,
          the stringified source calls `__name` outside the module scope and
          throws "ReferenceError: __name is not defined", so the theme class is
          never applied. Defining the esbuild-compatible helper first makes the
          injected script safe in either case.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "self.__name=function(n,t){try{Object.defineProperty(n,\"name\",{value:t,configurable:true})}catch(e){}return n};",
          }}
        />
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
