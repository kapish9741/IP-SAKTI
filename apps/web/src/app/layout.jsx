import "./globals.css";

export const metadata = {
  title: "AI Assistant — IP-SAKTI",
  description: "Citation-grounded question-answering system over Indian intellectual property and biodiversity law.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 15 15'><rect width='15' height='15' rx='3' fill='%230f172a'/><path d='M3 10h9M7.5 3v7M4 10l1.5-4 2 3 1.5-4L10.5 10' stroke='white' stroke-width='1.2' stroke-linecap='round' stroke-linejoin='round' fill='none'/></svg>" />
      </head>
      <body className="bg-white text-[#0f172a] antialiased selection:bg-blue-100 selection:text-blue-900">
        {children}
      </body>
    </html>
  );
}
