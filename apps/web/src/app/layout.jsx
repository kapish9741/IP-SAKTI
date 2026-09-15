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
        <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>⚖️</text></svg>" />
      </head>
      <body className="bg-white text-[#0f172a] antialiased selection:bg-blue-100 selection:text-blue-900">
        {children}
      </body>
    </html>
  );
}
