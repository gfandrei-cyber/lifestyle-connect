export const metadata = {
  title: 'CONNECT',
  description: 'Connection at your own pace',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
