import { Poppins } from "next/font/google";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata = {
  title: "AI Assistant — IP-SAKTI",
  description: "Citation-grounded question-answering system over Indian intellectual property and biodiversity law.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={poppins.variable}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500;1,600;1,700&display=swap"
          rel="stylesheet"
        />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 15 15'><rect width='15' height='15' rx='3' fill='%230f172a'/><path d='M3 10h9M7.5 3v7M4 10l1.5-4 2 3 1.5-4L10.5 10' stroke='white' stroke-width='1.2' stroke-linecap='round' stroke-linejoin='round' fill='none'/></svg>" />
      </head>
      <body className={`${poppins.className} font-sans bg-white text-[#0f172a] antialiased selection:bg-blue-100 selection:text-blue-900`}>
        {children}
      </body>
    </html>
  );
}
