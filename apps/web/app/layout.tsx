import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Redactor Guide - Administration',
  description: 'Gestion des guides touristiques',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body className="antialiased bg-gray-50">
        {children}
      </body>
    </html>
  );
}
