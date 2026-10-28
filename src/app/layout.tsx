import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Taller de Reparaciones | Control de Equipos",
  description:
    "Sistema de gestión de ingresos, reparaciones, entregas y balance de caja para taller de computación.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-800 font-sans">
        {children}
      </body>
    </html>
  );
}
