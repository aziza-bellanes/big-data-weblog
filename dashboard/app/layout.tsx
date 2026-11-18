import type { Metadata } from "next";
import localFont from "next/font/local";
import { AppSidebar } from "@/components/app-sidebar";
import { MotionProvider } from "@/components/motion";
import { PipelineProvider } from "@/components/pipeline/pipeline-context";
import { ThemeProvider } from "@/components/theme-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// Fonts ship with the image (@fontsource packages), so the build needs no network access.
// next/font reads these paths at build time: they must stay literal strings.
const archivo = localFont({
  variable: "--font-archivo",
  src: "../node_modules/@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2",
  weight: "100 900",
  display: "swap",
});
const jetbrains = localFont({
  variable: "--font-jetbrains",
  src: "../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
  weight: "100 800",
  display: "swap",
});
const poppins = localFont({
  variable: "--font-poppins",
  display: "swap",
  src: [
    { path: "../node_modules/@fontsource/poppins/files/poppins-latin-400-normal.woff2", weight: "400" },
    { path: "../node_modules/@fontsource/poppins/files/poppins-latin-500-normal.woff2", weight: "500" },
    { path: "../node_modules/@fontsource/poppins/files/poppins-latin-600-normal.woff2", weight: "600" },
  ],
});

export const metadata: Metadata = {
  title: { default: "Weblogs pipeline", template: "%s · Weblogs pipeline" },
  description: "NASA web traffic analytics with Flume, Kafka, HDFS, Hive and Sqoop.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${archivo.variable} ${poppins.variable} ${jetbrains.variable} antialiased`}
    >
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <MotionProvider>
            <TooltipProvider>
              <PipelineProvider>
                <SidebarProvider>
                  <AppSidebar />
                  <SidebarInset className="min-w-0">{children}</SidebarInset>
                </SidebarProvider>
                <Toaster position="bottom-right" />
              </PipelineProvider>
            </TooltipProvider>
          </MotionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
