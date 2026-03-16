This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Environment Variables

The frontend connects to a separate backend for the REST API and WebSocket (multiplayer rooms). Configure these when the backend is not running on `localhost:3001`:

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | URL of the backend REST API (e.g. `https://your-backend.onrender.com`) |
| `NEXT_PUBLIC_WS_URL` | URL of the backend WebSocket server (e.g. `wss://your-backend.onrender.com`) |

**Development defaults** (when not set): API `http://localhost:3001`, WebSocket `ws://localhost:3001`.

**Production example:**

```env
NEXT_PUBLIC_API_URL=https://your-backend.onrender.com
NEXT_PUBLIC_WS_URL=wss://your-backend.onrender.com
```

When `NEXT_PUBLIC_WS_URL` is not set, the app derives the WebSocket URL from the current page (e.g. `wss` when the site is served over HTTPS) to avoid mixed-content issues.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
